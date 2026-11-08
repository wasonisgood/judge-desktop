// 歷審裁判：判決內頁的「列印歷審清單」（printHistory.aspx）是伺服器直接產生的表格。
// 每一列：法院、案號（含裁定／判決）、裁判日期（民國）、參考資訊（圖示）。
// 圖示：icon_a（黑）＝案件目前繫屬法院或無該案號裁判書；icon_S（紅）＝目前上訴到最高法院／最高行政法院審理中。
// 順序：依司法院頁面的順序，前面為較早的審級，後面為較後的審級或尚在繫屬中的案件。
// 目前這一則在表中的位置：以「法院＋案號（含裁定／判決）＋裁判日期」比對；比對不唯一時不猜，明確回報無法判定。
import * as cheerio from 'cheerio';
import { cleanText, isoFromMinguo } from '../text/normalize';

export interface HistoryRow {
  court: string;
  caseNo: string;
  dateDisplay: string;
  dateIso: string | null;
  /** 尚無裁判日期或標示為「繫屬中」，尚未有可比對的裁判書。 */
  pending: boolean;
  /** 目前上訴到最高法院／最高行政法院審理中（紅色圖示）。 */
  supremeAppeal: boolean;
}

export type HistoryLocateStatus = 'located' | 'not_found' | 'ambiguous' | 'no_history' | 'error';

export interface HistoryPosition {
  status: HistoryLocateStatus;
  /** 目前這一則在 rows 中的索引（從 0 開始）；未定位時為 null。 */
  index: number | null;
  total: number;
  /** 較早的審級（依頁面順序，位於目前這一則之前）。 */
  prior: HistoryRow[];
  /** 較後的審級或繫屬中的案件（位於目前這一則之後）。 */
  subsequent: HistoryRow[];
  /** 整個歷審中是否有上訴到最高法院審理中的案件。 */
  supremeAppeal: boolean;
  /** 給人看、也給 AI 看的繁體中文說明。 */
  summary: string;
}

/** 解析「列印歷審清單」頁面的表格。沒有表格（沒有歷審）時回傳空陣列。 */
export function parsePrintHistory(html: string): HistoryRow[] {
  const $ = cheerio.load(html);
  const table = $('table').filter((_, t) => /法院/.test($(t).find('tr').first().text()) && /案號/.test($(t).find('tr').first().text())).first();
  if (!table.length) return [];
  const out: HistoryRow[] = [];
  table.find('tr').each((i, tr) => {
    if (i === 0) return; // 表頭
    const tds = $(tr).find('td').toArray();
    if (tds.length < 3) return;
    // 網站在上訴至最高法院的列前面加上「*」標記；比對與顯示時去掉，改由紅色圖示判斷。
    const court = cleanText($(tds[0]).text()).replace(/^\*+/, '');
    const caseNo = cleanText($(tds[1]).text()).replace(/^\*+/, '');
    const dateDisplay = cleanText($(tds[2]).text());
    if (!court && !caseNo) return;
    const icons = $(tr).find('img').toArray().map((img) => String($(img).attr('src') ?? ''));
    const black = icons.some((s) => /icon_a\.png/.test(s));
    const red = icons.some((s) => /icon_S\.png/.test(s));
    out.push({
      court,
      caseNo,
      dateDisplay,
      dateIso: dateDisplay ? isoFromMinguo(dateDisplay) : null,
      pending: !dateDisplay || black,
      supremeAppeal: red,
    });
  });
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** 目前這一則的識別資訊（來自內頁的裁判字號與裁判日期）。 */
export interface CurrentJudgmentRef {
  title: string;
  dateIso: string | null;
}

/**
 * 在歷審表中定位目前這一則。
 * 條件：案號（含裁定／判決）出現在字號中、法院名稱出現在字號中、裁判日期相同。
 * 完全沒有符合：not_found；多於一筆符合：ambiguous（不猜，只列出前後關係的說明）。
 */
export function locateInHistory(rows: HistoryRow[], current: CurrentJudgmentRef): HistoryPosition {
  const total = rows.length;
  const supremeAppeal = rows.some((r) => r.supremeAppeal);
  if (total === 0) {
    return { status: 'no_history', index: null, total, prior: [], subsequent: [], supremeAppeal, summary: '判決內頁沒有歷審資料（本案無其他審級的裁判書，或頁面未列出）。' };
  }
  const t = squash(current.title);
  const matches: number[] = [];
  rows.forEach((r, i) => {
    if (!r.caseNo || !r.court || r.pending) return;
    if (!t.includes(squash(r.court))) return;
    // 案號不含裁定／判決；類型（裁定、判決）另行比對，因為字號中間可能夾有「刑事」「民事」等字。
    const base = squash(r.caseNo).replace(/(裁定|判決)$/, '');
    const type = /判決$/.test(squash(r.caseNo)) ? '判決' : /裁定$/.test(squash(r.caseNo)) ? '裁定' : '';
    if (!t.includes(base)) return;
    if (type && !t.includes(type)) return;
    if (current.dateIso && r.dateIso && r.dateIso !== current.dateIso) return;
    matches.push(i);
  });
  if (matches.length === 0) {
    return { status: 'not_found', index: null, total, prior: [], subsequent: rows, supremeAppeal, summary: `歷審共 ${total} 筆，但無法在清單中找到本案（字號與日期都對不上）。` };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous', index: null, total, prior: [], subsequent: [], supremeAppeal,
      summary: `歷審共 ${total} 筆，其中有 ${matches.length} 筆與本案的法院、案號、日期相同，無法自動判定本案是哪一筆，請對照原頁面。`,
    };
  }
  const index = matches[0];
  const prior = rows.slice(0, index);
  const subsequent = rows.slice(index + 1);
  const parts = [`本案為歷審第 ${index + 1} 筆（共 ${total} 筆）`];
  if (prior.length) parts.push(`較早審級：${prior.map((r) => `${r.court} ${r.caseNo}`).join('；')}`);
  if (subsequent.length) parts.push(`之後：${subsequent.map((r) => `${r.court} ${r.caseNo}${r.pending ? '（繫屬中）' : ''}`).join('；')}`);
  if (supremeAppeal) parts.push('目前有案件上訴至最高法院審理中');
  return { status: 'located', index, total, prior, subsequent, supremeAppeal, summary: parts.join('。') + '。' };
}

/** 內頁讀取歷審失敗時的結果（不影響判決內容本身）。 */
export function historyErrorPosition(message: string): HistoryPosition {
  return { status: 'error', index: null, total: 0, prior: [], subsequent: [], supremeAppeal: false, summary: `歷審資料讀取失敗：${message}` };
}
