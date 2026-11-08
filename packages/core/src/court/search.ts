// 對外的檢索 API：關鍵字搜尋、法院選單、取得內頁。桌面端與遠端 MCP 都呼叫這裡。
import { CourtClient, BASE } from './client';
import { parseCourtMenu, parseDetailHtml, parseListHtml, type JudgmentDetail, type JudgmentSummary } from './parse';
import { historyErrorPosition, locateInHistory, parsePrintHistory } from './history';

export interface SearchOptions {
  maxItems?: number;
  /** 指定法院代碼（gc）；未指定則為全部法院。 */
  courtCode?: string;
  client?: CourtClient;
}

export async function searchJudgments(keyword: string, opts: SearchOptions = {}): Promise<JudgmentSummary[]> {
  const client = opts.client ?? new CourtClient();
  const q = await client.postKeyword(keyword);
  const listUrl = opts.courtCode
    ? `${BASE}qryresultlst.aspx?ty=JUDBOOK&q=${q}&gy=jcourt&gc=${encodeURIComponent(opts.courtCode)}`
    : `${BASE}qryresultlst.aspx?ty=JUDBOOK&q=${q}`;
  const items = parseListHtml(await client.request(listUrl));
  return opts.maxItems ? items.slice(0, opts.maxItems) : items;
}

export async function getCourtMenu(keyword: string, client = new CourtClient()) {
  const q = await client.postKeyword(keyword);
  return parseCourtMenu(await client.request(`${BASE}qryresultlst.aspx?ty=JUDBOOK&q=${q}`));
}

export async function getJudgmentDetail(id: string, client = new CourtClient()): Promise<JudgmentDetail> {
  const url = `${BASE}data.aspx?ty=JD&id=${encodeURIComponent(id)}&ot=in`;
  const d = parseDetailHtml(await client.request(url), id, url);
  // 歷審：同一個客戶端（同一個工作階段）取得列印歷審清單，再定位本案。失敗時只記錄原因，不影響判決內容。
  if (d.printHistoryUrl) {
    try {
      const rows = parsePrintHistory(await client.request(d.printHistoryUrl, { headers: { referer: url } }));
      d.history = rows;
      d.historyPosition = locateInHistory(rows, { title: d.meta.title, dateIso: d.meta.dateIso });
    } catch (err) {
      d.historyPosition = historyErrorPosition(err instanceof Error ? err.message : String(err));
    }
  } else {
    d.historyPosition = locateInHistory([], { title: d.meta.title, dateIso: d.meta.dateIso });
  }
  return d;
}
