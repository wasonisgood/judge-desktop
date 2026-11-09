// 爭點知識庫：Router（純函式）。
// 以關鍵詞精確命中加上字元二元組（bigram）的模糊相似度排序，只挑出與查詢相關的爭點。
// 重新檢索（AI 認為結果不準）：以排除已給過的 id 再找一次，並限制次數，避免無限重試花錢。
import type { KnowledgeIndex, IndexedIssue } from './types';

export interface RouteOptions {
  query: string;
  /** 只在指定法域或領域內找；未指定則全部。 */
  jurisdiction?: string;
  domain?: string;
  /** 回傳上限。 */
  limit?: number;
  /** 低於此分數的爭點不回傳。 */
  minScore?: number;
  /** 已給過、要排除的爭點 id（重新檢索用）。 */
  exclude?: string[];
}

export interface RouteHit {
  issue: IndexedIssue;
  score: number;
  /** 命中的理由（給 AI 與除錯用）。 */
  reasons: string[];
}

export interface RouteResult {
  query: string;
  hits: RouteHit[];
  /** 本次查詢是第幾次（1 為第一次）。 */
  attempt: number;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SCORE = 0.35;
/** 重新檢索的上限（含第一次查詢在內的總次數）。 */
export const MAX_ROUTE_ATTEMPTS = 3;

/** 正規化：小寫、去除空白與常見標點，保留中英文與數字。 */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length === 1) out.add(s);
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Dice 係數（0–1）：兩字串的字元二元組重疊程度，用來做模糊比對。 */
export function diceSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}

/** 對單一爭點評分。精確命中權重較高，模糊相似度為補充。 */
export function scoreIssue(issue: IndexedIssue, query: string): { score: number; reasons: string[] } {
  const q = normalizeText(query);
  const reasons: string[] = [];
  let score = 0;

  for (const kw of issue.keywords) {
    const nk = normalizeText(kw);
    if (nk && q.includes(nk)) {
      score += 1;
      reasons.push(`關鍵詞命中：${kw}`);
    }
  }
  // 模糊：每個關鍵詞與查詢的最佳相似度，取超過門檻的部分。
  let bestFuzzy = 0;
  for (const kw of issue.keywords) bestFuzzy = Math.max(bestFuzzy, diceSimilarity(query, kw));
  score += bestFuzzy;
  if (bestFuzzy >= 0.5) reasons.push(`關鍵詞模糊相近（${bestFuzzy.toFixed(2)}）`);

  const titlePath = [issue.title, ...issue.path].join(' ');
  const tp = diceSimilarity(query, titlePath);
  score += tp * 0.8;
  if (tp >= 0.3) reasons.push(`標題或路徑相近（${tp.toFixed(2)}）`);

  const body = diceSimilarity(query, `${issue.proposition} ${issue.distinction}`);
  score += body * 0.5;
  return { score, reasons };
}

/** 依查詢挑出相關爭點。結果依分數由高到低排序；分數相同時依 id 穩定排序。 */
export function routeIssues(index: KnowledgeIndex, opts: RouteOptions, attempt = 1): RouteResult {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const excluded = new Set(opts.exclude ?? []);
  const hits: RouteHit[] = [];
  for (const issue of index.issues) {
    if (excluded.has(issue.id)) continue;
    if (opts.jurisdiction && issue.jurisdiction !== opts.jurisdiction) continue;
    if (opts.domain && issue.domain !== opts.domain) continue;
    const { score, reasons } = scoreIssue(issue, opts.query);
    if (score >= minScore) hits.push({ issue, score, reasons });
  }
  hits.sort((a, b) => b.score - a.score || (a.issue.id < b.issue.id ? -1 : a.issue.id > b.issue.id ? 1 : 0));
  return { query: opts.query, hits: hits.slice(0, limit), attempt };
}

export interface RerouteRequest {
  /** AI 改寫後的查詢（或沿用原查詢）。 */
  query: string;
  /** 前次結果中的爭點 id，本次一律排除。 */
  previousIds: string[];
  /** 前次的查詢次數（第一次查詢為 1）。 */
  previousAttempt: number;
  jurisdiction?: string;
  domain?: string;
  limit?: number;
  minScore?: number;
}

export type RerouteOutcome =
  | { ok: true; result: RouteResult }
  | { ok: false; reason: string };

/**
 * AI 認為 Router 找得不準時的重新檢索。
 * 會排除前次已給過的爭點，並限制總次數為 MAX_ROUTE_ATTEMPTS，超過則回傳原因而不查詢。
 */
export function rerouteIssues(index: KnowledgeIndex, req: RerouteRequest): RerouteOutcome {
  const attempt = req.previousAttempt + 1;
  if (attempt > MAX_ROUTE_ATTEMPTS) {
    return { ok: false, reason: `已達重新檢索上限（${MAX_ROUTE_ATTEMPTS} 次）` };
  }
  return {
    ok: true,
    result: routeIssues(index, {
      query: req.query,
      jurisdiction: req.jurisdiction,
      domain: req.domain,
      limit: req.limit,
      minScore: req.minScore,
      exclude: req.previousIds,
    }, attempt),
  };
}
