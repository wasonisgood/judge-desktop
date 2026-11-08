// 司法院裁判書查詢系統的 HTTP 客戶端（ASP.NET WebForms，有狀態）。
// 移植自 judge_mcp/fjud_mcp/crawler.py：GET 首頁取 ViewState → POST 關鍵字 → 解析列表 → GET 內頁。
// 所有請求都經過 throttle，最小間隔 0.8 秒（與原程式一致）。
import * as cheerio from 'cheerio';

export const BASE = 'https://judgment.judicial.gov.tw/FJUD/';
const USER_AGENT = 'Mozilla/5.0 (judge-desktop; research tool)';

export interface ClientOptions {
  minIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** 極簡 cookie jar：只保存 name=value，足夠 WebForms 會話使用。 */
class CookieJar {
  private cookies = new Map<string, string>();
  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  absorb(res: Response): void {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const pair = line.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

export class CourtClient {
  private jar = new CookieJar();
  private lastAt = 0;
  private readonly minInterval: number;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.minInterval = opts.minIntervalMs ?? 800;
    this.timeout = opts.timeoutMs ?? 25_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** 所有對外請求的唯一入口：強制限速、帶 cookie、設定逾時。 */
  async request(url: string, init: RequestInit = {}): Promise<string> {
    const wait = this.lastAt + this.minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastAt = Date.now();

    const headers = new Headers(init.headers);
    headers.set('user-agent', USER_AGENT);
    if (this.jar.header()) headers.set('cookie', this.jar.header());
    const res = await this.fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(this.timeout) });
    this.jar.absorb(res);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.text();
  }

  /** 下載二進位內容（例如原版判決 PDF）。與 request 相同的限速、cookie 與逾時。 */
  async requestBytes(url: string, init: RequestInit = {}): Promise<Buffer> {
    const wait = this.lastAt + this.minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastAt = Date.now();
    const headers = new Headers(init.headers);
    headers.set('user-agent', USER_AGENT);
    if (this.jar.header()) headers.set('cookie', this.jar.header());
    const res = await this.fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(this.timeout) });
    this.jar.absorb(res);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** 取得 WebForms 的隱藏欄位（ViewState 等）。 */
  async getViewState(): Promise<Record<string, string>> {
    const html = await this.request(`${BASE}default.aspx`);
    const $ = cheerio.load(html);
    const vs = $('#__VIEWSTATE').attr('value');
    const ev = $('#__EVENTVALIDATION').attr('value');
    if (!vs || !ev) throw new Error('抓不到 __VIEWSTATE / __EVENTVALIDATION（網站可能改版）');
    return {
      __VIEWSTATE: vs,
      __EVENTVALIDATION: ev,
      __VIEWSTATEGENERATOR: $('#__VIEWSTATEGENERATOR').attr('value') ?? '',
    };
  }

  /** 送出關鍵字查詢，回傳結果頁的 q 參數（之後用來取得列表）。 */
  async postKeyword(keyword: string): Promise<string> {
    const form = new URLSearchParams({
      ...(await this.getViewState()),
      txtKW: keyword,
      judtype: 'JUDBOOK',
      whosub: '0',
      'ctl00$cp_content$btnSimpleQry': '送出查詢',
      __VIEWSTATEENCRYPTED: '',
    });
    const html = await this.request(`${BASE}default.aspx`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const href = cheerio.load(html)("#result-count a[href*='qryresultlst.aspx'], a[href*='qryresultlst.aspx']").first().attr('href');
    if (!href) throw new Error('查無查詢結果入口（可能無結果，或遭風控）');
    const q = new URL(href, BASE).searchParams.get('q');
    if (!q) throw new Error('結果連結沒有 q 參數');
    return q;
  }
}
