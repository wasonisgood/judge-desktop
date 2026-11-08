// 範圍整理表：依「條例／法規」為範圍，列出引用該法規的判決，並整理成一張表。
// 對應 R2（各條例的 Word 判決整理表）。流程：搜尋法規名稱 → 逐筆取得內頁 → 確認確實引用該法規 → 篩選期間 → 整理欄位。
import { CourtClient } from './client';
import { searchJudgments, getJudgmentDetail } from './search';
import type { JudgmentDetail } from './parse';
import { parseCitations } from '../law/citation';
import type { HistoryArticle } from '../law/history';
import { citationLawNotes, type CitationLawNote } from '../law/citationNotes';

export interface ScopeOptions {
  statute: string;
  /** 西元年；未設定則不限制。 */
  yearFrom?: number;
  yearTo?: number;
  /** 最多處理的筆數（每筆都要取得內頁，會花時間）。 */
  maxItems?: number;
  client?: CourtClient;
  /** 進度回報。 */
  onProgress?: (done: number, total: number) => void;
  /** 法條沿革（來自立法院）；提供後，每列會標示引用條文在查詢期間內是否修法。 */
  lawHistory?: HistoryArticle[];
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
  const client = opts.client ?? new CourtClient();
  const max = Math.min(Math.max(opts.maxItems ?? 30, 1), 200);
  const candidates = await searchJudgments(opts.statute, { maxItems: max * 2, client });
  const rows: ScopeRow[] = [];
  let done = 0;
  for (const it of candidates) {
    if (rows.length >= max) break;
    done++;
    opts.onProgress?.(done, candidates.length);
    const year = it.dateIso ? Number(it.dateIso.slice(0, 4)) : null;
    if (opts.yearFrom && year && year < opts.yearFrom) continue;
    if (opts.yearTo && year && year > opts.yearTo) continue;
    const d = await getJudgmentDetail(it.id, client);
    const cited = articlesCiting(d, opts.statute);
    if (cited.length === 0) continue; // 只保留真的引用該法規的判決
    rows.push({
      id: it.id,
      title: d.meta.title || it.title,
      court: d.meta.court,
      dateIso: d.meta.dateIso ?? it.dateIso,
      cause: d.meta.cause || it.cause,
      result: resultOf(d.sections['主文'] ?? ''),
      citedArticles: cited,
      lawNotes: opts.lawHistory
        ? citationLawNotes(parseCitations(cited.join('；')), opts.lawHistory, { from: opts.yearFrom ? `${opts.yearFrom}-01-01` : undefined, to: opts.yearTo ? `${opts.yearTo}-12-31` : undefined })
        : [],
      excerpts: { main: (d.sections['主文'] ?? '').slice(0, 1200), citing: citingExcerpt(d.fullText, opts.statute) },
      href: d.meta.sourceUrl,
    });
  }
  return rows;
}
