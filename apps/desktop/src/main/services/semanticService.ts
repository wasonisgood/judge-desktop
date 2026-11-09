// 段落檢索服務（issue #10 桌面端）：關鍵字取候選 → 條件篩選 → 逐筆取內文並切段 → AI 段落重排。
// 不依賴 Electron，可直接以 node 測試；取內文、搜尋與 AI 皆由呼叫端注入（IPC 層接快取版本）。
import {
  splitPassages, rankPassages, groupByCase, type AiComplete, type CaseGroup, type JudgmentDetail, type JudgmentSummary,
  type PassageKind, type RankCandidate, type RankedHit,
} from '@judge/core';
import { toUserError } from './userError';

export const SEMANTIC_MAX_CANDIDATES = 500;

export type CourtLevel = 'all' | 'supreme' | 'high' | 'district';
export type CaseType = 'all' | 'criminal' | 'civil' | 'family' | 'administrative';

/** 篩選條件（結構沿用 court/scope.ts 的年份範圍，另加法院層級與案件類型）。 */
export interface SemanticFilter {
  courtLevel: CourtLevel;
  caseType: CaseType;
  yearFrom?: number;
  yearTo?: number;
}

const COURT_PATTERN: Record<Exclude<CourtLevel, 'all'>, RegExp> = {
  supreme: /最高法院/,
  high: /高等(行政)?法院/,
  district: /地方法院/,
};

const CASE_TYPE_PATTERN: Record<Exclude<CaseType, 'all'>, RegExp> = {
  criminal: /刑事/,
  civil: /民事/,
  family: /家事/,
  administrative: /行政法院|行政訴訟/,
};

export function normalizeFilter(raw: Partial<SemanticFilter> | undefined): SemanticFilter {
  const courtLevel: CourtLevel = raw?.courtLevel && raw.courtLevel in COURT_PATTERN ? raw.courtLevel : 'all';
  const caseType: CaseType = raw?.caseType && raw.caseType in CASE_TYPE_PATTERN ? raw.caseType : 'all';
  const year = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 1900 && v < 2200 ? Math.floor(v) : undefined);
  return { courtLevel, caseType, yearFrom: year(raw?.yearFrom), yearTo: year(raw?.yearTo) };
}

/** 依標題（裁判法院與字號、判決類型）與年份篩選搜尋結果。年份缺漏的筆數不因年份被排除（與範圍整理一致）。 */
export function filterSummaries(items: JudgmentSummary[], filter: SemanticFilter): JudgmentSummary[] {
  return items.filter((it) => {
    if (filter.courtLevel !== 'all' && !COURT_PATTERN[filter.courtLevel].test(it.title)) return false;
    if (filter.caseType !== 'all' && !CASE_TYPE_PATTERN[filter.caseType].test(it.title)) return false;
    const year = it.dateIso ? Number(it.dateIso.slice(0, 4)) : null;
    if (filter.yearFrom && year && year < filter.yearFrom) return false;
    if (filter.yearTo && year && year > filter.yearTo) return false;
    return true;
  });
}

export interface SemanticArgs {
  keyword: string;
  /** 研究問題（交給 AI 排序；未設定 AI 時作為關鍵字回退的依據）。 */
  query: string;
  kind: PassageKind;
  filter: SemanticFilter;
  maxCandidates: number;
}

export interface SemanticDeps {
  search: (keyword: string, maxItems: number) => Promise<JudgmentSummary[]>;
  detail: (id: string) => Promise<JudgmentDetail>;
  ai?: AiComplete;
  /** 無法取得 AI 時的原因（例如尚未設定金鑰），會併入回退的 notice。 */
  aiError?: string;
  signal: AbortSignal;
  onProgress?: (p: { done: number; total: number; phase: string }) => void;
}

export interface CaseSource {
  title: string;
  court: string | null;
  href: string;
}

export interface SemanticRun {
  /** 關鍵字搜尋回傳筆數。 */
  candidates: number;
  /** 通過篩選、實際取內文的筆數上限。 */
  considered: number;
  /** 成功取得內文的筆數。 */
  fetched: number;
  hits: RankedHit[];
  scoreSource: 'ai' | 'keyword';
  notice: string | null;
  discarded: number;
  bySimilarity: CaseGroup[];
  byCaseNo: CaseGroup[];
  sources: Record<string, CaseSource>;
  notes: string[];
  cancelled: boolean;
}

export async function runSemanticSearch(args: SemanticArgs, deps: SemanticDeps): Promise<SemanticRun> {
  const max = Math.min(Math.max(args.maxCandidates || SEMANTIC_MAX_CANDIDATES, 1), SEMANTIC_MAX_CANDIDATES);
  const found = await deps.search(args.keyword, max);
  const considered = filterSummaries(found, args.filter).slice(0, max);
  const notes: string[] = [];
  const cands: RankCandidate[] = [];
  const sources: Record<string, CaseSource> = {};
  let done = 0;
  for (const it of considered) {
    if (deps.signal.aborted) break;
    done++;
    deps.onProgress?.({ done, total: considered.length, phase: '讀取判決內文' });
    try {
      const d = await deps.detail(it.id);
      if (deps.signal.aborted) break;
      cands.push({
        caseId: it.id,
        caseNo: d.meta.caseNo ?? null,
        dateIso: d.meta.dateIso ?? it.dateIso,
        fullText: d.fullText,
        passages: splitPassages(it.id, d.sections ?? {}),
      });
      sources[it.id] = { title: d.meta.title || it.title, court: d.meta.court, href: d.meta.sourceUrl || it.href };
    } catch (err) {
      notes.push(`${it.id}：${toUserError(err).message}`);
    }
  }
  const base = { candidates: found.length, considered: considered.length, fetched: cands.length, sources, notes };
  if (deps.signal.aborted) {
    return { ...base, hits: [], scoreSource: 'keyword', notice: '已取消，未完成段落排序。', discarded: 0, bySimilarity: [], byCaseNo: [], cancelled: true };
  }
  const r = await rankPassages(deps.ai, args.query, args.kind, cands);
  const notice = !deps.ai && deps.aiError ? `${deps.aiError}，已改以關鍵字排序（非語意）。` : r.notice;
  return {
    ...base,
    hits: r.hits,
    scoreSource: r.scoreSource,
    notice,
    discarded: r.discarded,
    bySimilarity: groupByCase(r.hits, 'similarity'),
    byCaseNo: groupByCase(r.hits, 'caseNo'),
    cancelled: deps.signal.aborted,
  };
}
