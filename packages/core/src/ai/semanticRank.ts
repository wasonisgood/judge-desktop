// 段落的語意重排（issue #10，階段一）：由 AI 依研究問題對候選段落排序，回傳「AI 評分（非向量相似度）」與依據。
// 規則：
// - AI 給出的段落必須附上逐字引用，且該引用必須在原判決中找得到（沿用 ai/evidence.ts）；找不到的一律丟棄。
// - AI 失敗（服務錯誤、格式錯誤）時回退為關鍵字重排，結果明確標示 fallback=true，不假裝是語意結果。
// - 純函式：AI 呼叫由呼叫端注入。
import { locateQuote } from './evidence';
import { parseJsonReply, type AiComplete } from './analysis';
import type { Passage, PassageKind } from '../court/passages';

export interface RankCandidate {
  caseId: string;
  caseNo: string | null;
  dateIso: string | null;
  fullText: string;
  passages: Passage[];
}

export interface RankedHit {
  caseId: string;
  caseNo: string | null;
  dateIso: string | null;
  passageId: string;
  kind: PassageKind;
  /** 段落原文（逐字來自判決）。 */
  passageText: string;
  /** 0 至 1 的 AI 評分（或關鍵字回退時的覆蓋率）。畫面上必須標示「AI 評分，非向量相似度」。 */
  score: number;
  /** 通過原文比對的引用（逐字出現在判決中）。 */
  quote: string;
  basis: string;
}

export interface RankResult {
  hits: RankedHit[];
  /** 'ai' 表示由 AI 評分；'keyword' 表示 AI 失敗後的回退。 */
  scoreSource: 'ai' | 'keyword';
  /** 回退時的說明（給使用者看）。 */
  notice: string | null;
  /** AI 回覆中被丟棄的筆數（引文無法逐字找到、序號不合法等）。 */
  discarded: number;
}

const BATCH = 40;
const MAX_PASSAGE_CHARS = 500;

export interface Numbered {
  n: number;
  candidate: RankCandidate;
  passage: Passage;
}

function numberPassages(cands: RankCandidate[], kind: PassageKind): Numbered[] {
  const out: Numbered[] = [];
  for (const c of cands) {
    for (const p of c.passages) {
      if (p.kind !== kind) continue;
      out.push({ n: out.length + 1, candidate: c, passage: p });
    }
  }
  return out;
}

export function buildRankPrompt(query: string, kind: PassageKind, items: Numbered[]): { system: string; user: string } {
  const label = kind === 'fact' ? '犯罪事實（法律事實）' : '法官見解（理由論述）';
  const list = items.map((it) => `[${it.n}] ${it.passage.text.slice(0, MAX_PASSAGE_CHARS)}`).join('\n');
  return {
    system: [
      `你是台灣法律研究助理。依研究問題，對下列「${label}」段落評估相關程度。`,
      '只根據段落原文判斷，不得編造。',
      '只輸出一個 JSON 物件：{"ranked":[{"n":段落編號,"score":0到1的數字,"quote":"從該段逐字引用的句子","basis":"一句繁體中文說明為何相關"}]}。',
      '只列出相關的段落（最多 20 筆）；quote 必須是該段原文中逐字出現的句子。',
    ].join('\n'),
    user: `研究問題：${query}\n\n段落：\n${list}`,
  };
}

interface AiRankRow {
  n?: unknown;
  score?: unknown;
  quote?: unknown;
  basis?: unknown;
}

/** 解析並驗證 AI 排序：序號需存在、分數需為有限數字（夾在 0–1）、引文需逐字存在於該案判決原文。 */
export function verifyRanking(raw: string, items: Numbered[]): { hits: RankedHit[]; discarded: number } {
  let parsed: { ranked?: unknown };
  try {
    parsed = parseJsonReply<{ ranked?: unknown }>(raw);
  } catch {
    throw new Error('AI 回覆不是有效的 JSON');
  }
  if (!Array.isArray(parsed.ranked)) throw new Error('AI 回覆缺少 ranked 陣列');
  const byN = new Map(items.map((it) => [it.n, it]));
  const hits: RankedHit[] = [];
  let discarded = 0;
  const seen = new Set<string>();
  for (const row of parsed.ranked as AiRankRow[]) {
    const it = typeof row?.n === 'number' ? byN.get(row.n) : undefined;
    const score = typeof row?.score === 'number' && Number.isFinite(row.score) ? Math.min(1, Math.max(0, row.score)) : null;
    const quote = typeof row?.quote === 'string' ? row.quote.trim() : '';
    if (!it || score === null || !quote || seen.has(it.passage.id)) {
      discarded++;
      continue;
    }
    // 引文必須逐字存在於該案判決原文中（不只是段落），才採信。
    if (!locateQuote(it.candidate.fullText, quote)) {
      discarded++;
      continue;
    }
    seen.add(it.passage.id);
    hits.push({
      caseId: it.candidate.caseId,
      caseNo: it.candidate.caseNo,
      dateIso: it.candidate.dateIso,
      passageId: it.passage.id,
      kind: it.passage.kind,
      passageText: it.passage.text,
      score,
      quote,
      basis: typeof row.basis === 'string' ? row.basis.trim() : '',
    });
  }
  return { hits: hits.sort((a, b) => b.score - a.score), discarded };
}

/** 關鍵字回退：以研究問題的 2 字詞組覆蓋率計分（0–1）。沒有任何命中的段落不列入。 */
export function keywordRank(query: string, kind: PassageKind, cands: RankCandidate[]): RankedHit[] {
  const grams = new Set<string>();
  const q = query.replace(/\s+/g, '');
  for (let i = 0; i + 2 <= q.length; i++) grams.add(q.slice(i, i + 2));
  if (!grams.size) return [];
  const hits: RankedHit[] = [];
  for (const c of cands) {
    for (const p of c.passages) {
      if (p.kind !== kind) continue;
      const hit = [...grams].filter((g) => p.text.includes(g));
      if (!hit.length) continue;
      const score = hit.length / grams.size;
      hits.push({
        caseId: c.caseId,
        caseNo: c.caseNo,
        dateIso: c.dateIso,
        passageId: p.id,
        kind,
        passageText: p.text,
        score,
        quote: hit.slice(0, 3).join('、'),
        basis: `關鍵字覆蓋 ${hit.length}／${grams.size} 個詞組（回退結果，非語意評分）`,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

/**
 * 段落重排。AI 失敗時回退為關鍵字，並回傳 notice。
 * 候選段落超過 BATCH 時分批送出；任一批次成功才採用 AI 結果，全部失敗才回退。
 */
export async function rankPassages(ai: AiComplete | undefined, query: string, kind: PassageKind, cands: RankCandidate[]): Promise<RankResult> {
  const items = numberPassages(cands, kind);
  if (!items.length) return { hits: [], scoreSource: 'ai', notice: null, discarded: 0 };
  if (!ai) {
    return { hits: keywordRank(query, kind, cands), scoreSource: 'keyword', notice: '尚未設定 AI 服務，已以關鍵字排序（非語意）。', discarded: 0 };
  }
  const hits: RankedHit[] = [];
  let discarded = 0;
  let okBatches = 0;
  let lastError: string | null = null;
  for (let s = 0; s < items.length; s += BATCH) {
    const batch = items.slice(s, s + BATCH).map((it, i) => ({ ...it, n: i + 1 }));
    try {
      const { system, user } = buildRankPrompt(query, kind, batch);
      const raw = await ai(system, user, 1500);
      const r = verifyRanking(raw, batch);
      // 把批次內的序號換回全域的段落對應（verifyRanking 只用批次內序號，hits 已含正確的 passageId）。
      hits.push(...r.hits);
      discarded += r.discarded;
      okBatches++;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (okBatches === 0) {
    return {
      hits: keywordRank(query, kind, cands),
      scoreSource: 'keyword',
      notice: `AI 語意排序失敗（${lastError ?? '未知原因'}），已改以關鍵字排序（非語意）。`,
      discarded: 0,
    };
  }
  const merged = new Map<string, RankedHit>();
  for (const h of hits) {
    const prev = merged.get(h.passageId);
    if (!prev || h.score > prev.score) merged.set(h.passageId, h);
  }
  return {
    hits: [...merged.values()].sort((a, b) => b.score - a.score),
    scoreSource: 'ai',
    notice: okBatches < Math.ceil(items.length / BATCH) ? '部分批次 AI 排序失敗，結果僅涵蓋成功的批次。' : null,
    discarded,
  };
}

export interface CaseGroup {
  caseId: string;
  caseNo: string | null;
  dateIso: string | null;
  best: number;
  hits: RankedHit[];
}

export type SortMode = 'similarity' | 'caseNo';

/** 同一案號的多個段落合併為一組；依相似度（每案取最高分）或案號排序。 */
export function groupByCase(hits: RankedHit[], sort: SortMode = 'similarity'): CaseGroup[] {
  const map = new Map<string, CaseGroup>();
  for (const h of hits) {
    const g = map.get(h.caseId);
    if (g) {
      g.hits.push(h);
      g.best = Math.max(g.best, h.score);
    } else {
      map.set(h.caseId, { caseId: h.caseId, caseNo: h.caseNo, dateIso: h.dateIso, best: h.score, hits: [h] });
    }
  }
  const groups = [...map.values()];
  for (const g of groups) g.hits.sort((a, b) => b.score - a.score);
  if (sort === 'caseNo') return groups.sort((a, b) => (a.caseNo ?? '').localeCompare(b.caseNo ?? '', 'zh-Hant'));
  return groups.sort((a, b) => b.best - a.best);
}
