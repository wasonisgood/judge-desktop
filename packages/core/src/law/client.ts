// 法規資料的網路客戶端（移植自 legel-mcp 與 law_history_mcp 的查詢流程，改為 TypeScript）。
// - 現行法規：全國法規資料庫 law.moj.gov.tw（以法名查 pcode，再取得全文）。
// - 法條沿革：立法院法律系統 lis.ly.gov.tw（ASP.NET 表單，需先取得表單欄位再送出查詢）。
// TLS 憑證驗證一律保持開啟，不得關閉。所有請求都經過限速。
import * as cheerio from 'cheerio';
import { parseCurrentLawHtml, type CurrentLaw } from './articles';
import { parseLawHistoryHtml, type HistoryArticle } from './history';

export const MOJ_BASE = 'https://law.moj.gov.tw/';
export const LIS_BASE = 'https://lis.ly.gov.tw';
const USER_AGENT = 'Mozilla/5.0 (judge-desktop; research tool)';

export interface LawClientOptions {
  minIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface LawNameMatch {
  name: string;
  pcode: string;
}

export class LawClient {
  private lastAt = 0;
  private readonly minInterval: number;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;
  private cookies = new Map<string, string>();

  constructor(opts: LawClientOptions = {}) {
    this.minInterval = opts.minIntervalMs ?? 800;
    this.timeout = opts.timeoutMs ?? 25_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(res: Response): void {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const pair = line.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  /** 單次請求：限速、帶 cookie、設定逾時；不自動跟隨轉址（由呼叫端決定）。 */
  async requestRaw(url: string, init: RequestInit = {}): Promise<Response> {
    const wait = this.lastAt + this.minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastAt = Date.now();

    const headers = new Headers(init.headers);
    headers.set('user-agent', USER_AGENT);
    if (this.cookieHeader()) headers.set('cookie', this.cookieHeader());
    const res = await this.fetchImpl(url, {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeout),
    });
    this.absorb(res);
    return res;
  }

  /** 取得文字內容；遇到轉址會手動跟隨（最多五次，並保留 cookie）。 */
  async request(url: string, init: RequestInit = {}): Promise<string> {
    let current = url;
    let opts = init;
    for (let hop = 0; hop < 5; hop++) {
      const res = await this.requestRaw(current, opts);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`HTTP ${res.status} 沒有轉址位置：${current}`);
        current = new URL(loc, current).toString();
        opts = { method: 'GET' }; // 轉址一律改為 GET
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${current}`);
      return res.text();
    }
    throw new Error(`轉址次數過多：${url}`);
  }

  // -------------------------------------------------------------------------
  // 現行法規
  // -------------------------------------------------------------------------

  /** 以法規名稱查詢全國法規資料庫，回傳完全相同的法名與建議清單。 */
  async searchMojByName(name: string): Promise<{ exact: LawNameMatch | null; suggestions: LawNameMatch[] }> {
    const home = await this.request(MOJ_BASE);
    const $ = cheerio.load(home);
    const val = (id: string) => $(`input#${id}`).attr('value') ?? '';
    const vs = val('__VIEWSTATE');
    const vsg = val('__VIEWSTATEGENERATOR');
    const ev = val('__EVENTVALIDATION');
    if (!vs || !vsg) throw new Error('無法取得全國法規資料庫的表單狀態（網站可能改版）');

    const form = new URLSearchParams({
      __VIEWSTATE: vs,
      __VIEWSTATEGENERATOR: vsg,
      __EVENTTARGET: '',
      __EVENTARGUMENT: '',
      __VIEWSTATEENCRYPTED: '',
      'ctl00$hidMode': '',
      'ctl00$hidVal': 'ONEBAR',
      'ctl00$hidkw': '',
      'ctl00$keyword': '',
      'ctl00$msKeyword': name.trim(),
      'ctl00$btnMsQall': '查詢',
      'ctl00$txtEMail': '',
    });
    if (ev) form.set('__EVENTVALIDATION', ev);
    const html = await this.request(MOJ_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });

    const $r = cheerio.load(html);
    const rows: LawNameMatch[] = [];
    $r('a#hlkLawLink').each((_, a) => {
      const text = ($r(a).attr('title') || $r(a).text()).trim();
      const href = $r(a).attr('href') ?? '';
      const pcode = new URL(href, MOJ_BASE).searchParams.get('pcode');
      if (pcode) rows.push({ name: text, pcode });
    });
    const exact = rows.find((r) => r.name === name.trim()) ?? null;
    return { exact, suggestions: rows };
  }

  /** 取得法規全文（依 pcode）。 */
  async fetchCurrentLaw(pcode: string): Promise<CurrentLaw> {
    const url = `${MOJ_BASE}LawClass/LawAll.aspx?pcode=${encodeURIComponent(pcode)}`;
    return parseCurrentLawHtml(await this.request(url), pcode);
  }

  // -------------------------------------------------------------------------
  // 法條沿革（立法院）
  // -------------------------------------------------------------------------

  /** 從立法院表單取得送出查詢所需的欄位。 */
  private async legacyFormPayload(): Promise<{ action: string; payload: Record<string, string> }> {
    const html = await this.request(`${LIS_BASE}/lglawc/lglawkm`);
    const $ = cheerio.load(html);
    const form = $('form').first();
    if (!form.length) throw new Error('找不到立法院查詢表單（網站可能改版或暫時無法使用）');
    const payload: Record<string, string> = {};
    form.find('input[name]').each((_, el) => {
      const $el = $(el);
      const type = ($el.attr('type') ?? '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return;
      if (type === 'image') return;
      payload[$el.attr('name')!] = $el.attr('value') ?? '';
    });
    form.find('select[name]').each((_, el) => {
      const $sel = $(el);
      payload[$sel.attr('name')!] = $sel.find('option').first().attr('value') ?? '';
    });
    return { action: form.attr('action') ?? '/lglawc/lglawkm', payload };
  }

  /** 依法名搜尋立法院資料庫，找出完全相同的法名；找不到時拋出錯誤。 */
  private async findLisLawPage(name: string): Promise<string> {
    const { action, payload } = await this.legacyFormPayload();
    payload['_1_6_T'] = name.trim();
    payload['@_1_6_T'] = 'T_LN/LW';
    payload['_IMG_檢索.x'] = '38';
    payload['_IMG_檢索.y'] = '12';
    const html = await this.request(new URL(action, LIS_BASE).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload),
    });
    const $ = cheerio.load(html);
    let href: string | null = null;
    $('table.sumtab td.sumtd2_TI').each((_, td) => {
      if (href) return;
      const a = $(td).find('a[href]').first();
      if (a.text().replace(/\s+/g, '') === name.replace(/\s+/g, '')) href = a.attr('href') ?? null;
    });
    if (!href) throw new Error(`立法院資料庫查無完全相同的法名：${name}`);
    return new URL(href, LIS_BASE).toString();
  }

  /** 取得某部法律的法條沿革（每一條的歷次修法版本）。 */
  async fetchLawHistory(name: string): Promise<{ history: HistoryArticle[]; sourceUrl: string; historyUrl: string }> {
    const lawUrl = await this.findLisLawPage(name);
    const lawHtml = await this.request(lawUrl);
    const $ = cheerio.load(lawHtml);
    const link = $('a').filter((_, a) => /法條沿革/.test($(a).text())).first().attr('href');
    if (!link) throw new Error(`找不到「${name}」的法條沿革連結`);
    const historyUrl = new URL(link, LIS_BASE).toString();
    const history = parseLawHistoryHtml(await this.request(historyUrl));
    return { history, sourceUrl: lawUrl, historyUrl };
  }
}
