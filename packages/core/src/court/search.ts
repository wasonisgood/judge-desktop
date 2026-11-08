// 對外的檢索 API：關鍵字搜尋、法院選單、取得內頁。桌面端與遠端 MCP 都呼叫這裡。
import { CourtClient, BASE } from './client';
import { parseCourtMenu, parseDetailHtml, parseListHtml, type JudgmentDetail, type JudgmentSummary } from './parse';

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
  return parseDetailHtml(await client.request(url), id, url);
}
