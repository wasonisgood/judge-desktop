// 範圍整理表：依「條例／法規」為範圍，列出引用該法規的判決，並整理成一張表。
// 對應 R2（各條例的 Word 判決整理表）。流程：搜尋法規名稱 → 逐筆取得內頁 → 確認確實引用該法規 → 篩選期間 → 整理欄位。
import { CourtClient } from './client';
import { jurisdictionRegistry, type JurisdictionId } from '../jurisdiction/registry';
import type { JudgmentDetail, JudgmentSummary } from './parse';
import { parseCitations } from '../law/citation';
import type { HistoryArticle } from '../law/history';
import { citationLawNotes, type CitationLawNote } from '../law/citationNotes';

export interface ScopeOptions {
  statute: string;
  /** 法院管轄區識別碼；未指定則使用預設管轄區（台灣司法院）。 */
  jurisdiction?: JurisdictionId;
  /** 西元年；未設定則不限制。 */
  yearFrom?: number;
  yearTo?: number;
  /** 實際送去司法院搜尋的關鍵字；未提供時使用法規名稱。引用比對一律以法規名稱進行。 */
  searchQuery?: string;
  /** 最多處理的筆數（每筆都要取得內頁，會花時間）。 */
  maxItems?: number;
  client?: CourtClient;
  /** 進度回報。 */
  onProgress?: (done: number, total: number) => void;
  /** 法條沿革（來自立法院）；提供後，每列會標示引用條文在查詢期間內是否修法。 */
  lawHistory?: HistoryArticle[];
  /** 搜尋來源（v3.6.1）：未提供時直接呼叫司法院；桌面端提供快取版本，讓前一階段已取得的資料直接繼承。 */
  searchSource?: (query: string, maxItems: number) => Promise<JudgmentSummary[]>;
  /** 內頁來源（v3.6.1）：同上，未提供時直接抓取；桌面端提供快取版本。 */
  detailSource?: (id: string) => Promise<JudgmentDetail>;
  /** 單筆內頁失敗時呼叫（v3.6.0）：該筆跳過，其餘照常；不再讓整輪搜尋失敗。 */
  onItemError?: (id: string, title: string, err: unknown) => void;
  /** 取消訊號：取消後停止取得內頁，回傳取消前已完成的列。 */
  signal?: AbortSignal;
  /**
   * 關鍵字模式（標編碼工序）：不以單一法規篩選，搜尋結果全部列出；引用條文取自判決的相關法條。
   * 此時 statute 只作顯示用，不做引用比對。
   */
  keywordMode?: boolean;
}

export interface ScopeRow {
  id: string;
  title: string;
  court: string | null;
  dateIso: string | null;
  cause: string;
  result: string;
  citedArticles: string[];
  /** 引用條文與期間內修法的對照（需提供 lawHistory）。 */
  lawNotes: CitationLawNote[];
  /** 本案在司法院歷審清單中的位置（說明文字）。 */
  historyPosition: string;
  /** 供 AI 分析用的原文摘錄：主文，以及法規被引用處前後的理由文字。 */
  excerpts: { main: string; citing: string };
  href: string;
}

/** 主文第一句，作為「結果」欄的摘要。 */
export function resultOf(mainText: string): string {
  const first = mainText.split(/\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? '';
  return first.length > 80 ? first.slice(0, 80) + '…' : first;
}

/** 去除所有空白（版面折行會把法規名稱切開，比對前先接回）。 */
const squash = (s: string) => s.replace(/\s+/g, '');

/**
 * 找出判決引用該法規的條文。
 * 1. 先看「相關法條」欄位；2. 再看全文中「法規名稱第 N 條」；3. 只寫法規名稱、沒寫條號時，回傳法規名稱本身。
 * 回傳空陣列表示沒有引用。
 */
function articlesCiting(detail: JudgmentDetail, statute: string): string[] {
  const key = squash(statute);
  const fromList = detail.relatedLaws.filter((l) => squash(l).includes(key));
  if (fromList.length) return fromList;
  const flat = squash(detail.fullText);
  if (!flat.includes(key)) return [];
  const NUM = '[0-9０-９一二三四五六七八九十百千零〇兩]+';
  const re = new RegExp(`${key}第${NUM}(?:\\s*-\\s*${NUM})*條(?:之${NUM})*(?:第${NUM}項)?(?:第${NUM}款)?`, 'g');
  const found = [...new Set(flat.match(re) ?? [])];
  return found.length ? found : [statute];
}

/** 法規被引用處前後各 400 字（找不到法規名稱時回傳理由段的開頭）。 */
export function citingExcerpt(fullText: string, statute: string): string {
  const i = fullText.indexOf(statute);
  if (i >= 0) return fullText.slice(Math.max(0, i - 400), i + statute.length + 400);
  const squashed = fullText.replace(/\s+/g, '');
  const j = squashed.indexOf(statute.replace(/\s+/g, ''));
  if (j >= 0) return squashed.slice(Math.max(0, j - 400), j + statute.length + 400);
  return fullText.slice(0, 800);
}

export async function buildScopeTable(opts: ScopeOptions): Promise<ScopeRow[]> {
  const jurisdiction = jurisdictionRegistry.get(opts.jurisdiction);
  const client = opts.client ?? new CourtClient();
  const max = Math.min(Math.max(opts.maxItems ?? 30, 1), 200);
  const query = opts.searchQuery?.trim() || opts.statute;
  const candidates = opts.searchSource
    ? await opts.searchSource(query, max * 2)
    : await jurisdiction.search(query, { maxItems: max * 2, client });
  const rows: ScopeRow[] = [];
  let done = 0;
  for (const it of candidates) {
    if (rows.length >= max || opts.signal?.aborted) break;
    done++;
    opts.onProgress?.(done, candidates.length);
    const year = it.dateIso ? Number(it.dateIso.slice(0, 4)) : null;
    if (opts.yearFrom && year && year < opts.yearFrom) continue;
    if (opts.yearTo && year && year > opts.yearTo) continue;
    let d;
    try {
      d = opts.detailSource ? await opts.detailSource(it.id) : await jurisdiction.getDetail(it.id, { client });
    } catch (err) {
      if (opts.signal?.aborted) break;
      opts.onItemError?.(it.id, it.title, err);
      continue;
    }
    let cited: string[];
    if (opts.keywordMode) {
      cited = d.relatedLaws.slice();
    } else {
      cited = articlesCiting(d, opts.statute);
      if (cited.length === 0) continue; // 只保留真的引用該法規的判決
    }
    rows.push({
      id: it.id,
      title: d.meta.title || it.title,
      court: d.meta.court,
      dateIso: d.meta.dateIso ?? it.dateIso,
      cause: d.meta.cause || it.cause,
      result: resultOf(d.sections['主文'] ?? ''),
      citedArticles: cited,
      historyPosition: d.historyPosition?.summary ?? '',
      lawNotes: opts.lawHistory
        ? citationLawNotes(parseCitations(cited.join('；')), opts.lawHistory, { from: opts.yearFrom ? `${opts.yearFrom}-01-01` : undefined, to: opts.yearTo ? `${opts.yearTo}-12-31` : undefined })
        : [],
      excerpts: { main: (d.sections['主文'] ?? '').slice(0, 1200), citing: opts.keywordMode && !opts.statute ? d.fullText.slice(0, 800) : citingExcerpt(d.fullText, opts.statute) },
      href: d.meta.sourceUrl,
    });
  }
  return rows;
}
