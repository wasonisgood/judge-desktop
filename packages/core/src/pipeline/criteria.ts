// 納入／排除標準的自動核查（issue #12）。
// 研究者定義條列標準；每條可選「程式判斷」（關鍵字，不呼叫 AI）或「AI 判斷」。
// AI 判斷的依據必須能在判決原文中逐字找到（沿用 ai/evidence.ts），找不到的依據一律視為無效，該條改為「無法判斷」。
// 每次執行是一份獨立的 run（可保存、比較），重新檢索的兩次結果分開保存。純函式；AI 呼叫由呼叫端注入。
import { keepVerifiedQuotes, normalizeForMatch } from '../ai/evidence';
import { parseJsonReply, type AiComplete } from '../ai/analysis';

export type CriterionKind = 'include' | 'exclude';
export type CriterionMethod = 'program' | 'ai';
export type Verdict = 'met' | 'not_met' | 'unknown';
export type CaseDecision = 'include' | 'exclude' | 'review';

export interface Criterion {
  id: string;
  kind: CriterionKind;
  /** 標準的文字描述（例如「原告為消費者」「未經上訴」）。 */
  text: string;
  method: CriterionMethod;
  /** 程式判斷用的關鍵字（method 為 program 時必填）。 */
  keywords?: string[];
  /** all：全部關鍵字都要出現；any：任一出現即符合。預設 any。 */
  keywordMode?: 'all' | 'any';
}

export interface CriterionResult {
  criterionId: string;
  verdict: Verdict;
  method: CriterionMethod;
  basis: string;
  /** 已通過原文比對的依據（逐字出現在判決中）。 */
  quotes: string[];
  /** AI 給出的依據無法在原文找到，因此被視為無效。 */
  invalidEvidence: boolean;
}

export interface CaseInput {
  id: string;
  caseNo: string | null;
  dateIso: string | null;
  fullText: string;
}

export interface CaseOutcome {
  id: string;
  caseNo: string | null;
  dateIso: string | null;
  decision: CaseDecision;
  results: CriterionResult[];
}

export interface RunSummary {
  total: number;
  include: number;
  exclude: number;
  review: number;
  /** 納入率：納入案件 ÷ 全部案件。 */
  matchRate: number;
  /** 無法判斷率：需人工檢視案件 ÷ 全部案件。 */
  reviewRate: number;
  invalidEvidenceCount: number;
}

export interface CriteriaRun {
  runNo: number;
  createdAt: string;
  /** 本次檢索的查詢詞（重新檢索時會不同）。 */
  query: string;
  criteria: Criterion[];
  outcomes: CaseOutcome[];
  summary: RunSummary;
  /** AI 對這次結果的重新檢索檢閱（研究者按下檢閱後才有）。 */
  review?: RerunReview;
}

// ---------------------------------------------------------------------------
// 驗證標準設定
// ---------------------------------------------------------------------------
export function validateCriteria(criteria: Criterion[]): string[] {
  const errors: string[] = [];
  if (!criteria.length) errors.push('請至少定義一條標準');
  const ids = new Set<string>();
  for (const c of criteria) {
    if (!c.id) errors.push('標準缺少識別碼');
    if (ids.has(c.id)) errors.push(`標準識別碼重複：${c.id}`);
    ids.add(c.id);
    if (!c.text.trim()) errors.push(`標準 ${c.id} 缺少描述`);
    if (c.kind !== 'include' && c.kind !== 'exclude') errors.push(`標準 ${c.id} 的類型必須是納入或排除`);
    if (c.method === 'program' && !(c.keywords ?? []).some((k) => k.trim())) errors.push(`標準「${c.text}」選擇程式判斷，但沒有提供關鍵字`);
    if (c.method !== 'program' && c.method !== 'ai') errors.push(`標準「${c.text}」的判斷方式不正確`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 程式判斷（不呼叫 AI）
// ---------------------------------------------------------------------------
const SNIPPET = 24;

/** 關鍵字判斷：找到的關鍵字附上前後文作為依據，依據文字一定是原文的逐字片段。 */
export function evaluateProgram(c: Criterion, fullText: string): CriterionResult {
  const text = normalizeForMatch(fullText);
  const keys = (c.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const found = keys.filter((k) => text.includes(normalizeForMatch(k)));
  const mode = c.keywordMode ?? 'any';
  const met = mode === 'all' ? keys.length > 0 && found.length === keys.length : found.length > 0;
  const quotes: string[] = [];
  if (fullText.trim()) {
    for (const k of found) {
      const i = fullText.indexOf(k);
      if (i >= 0) quotes.push(fullText.slice(Math.max(0, i - SNIPPET), Math.min(fullText.length, i + k.length + SNIPPET)).trim());
    }
  }
  const verdict: Verdict = !fullText.trim() ? 'unknown' : met ? 'met' : 'not_met';
  const basis = verdict === 'unknown'
    ? '判決原文為空，無法判斷'
    : `關鍵字（${mode === 'all' ? '全部' : '任一'}）：${keys.map((k) => (found.includes(k) ? `「${k}」出現` : `「${k}」未出現`)).join('；')}`;
  return { criterionId: c.id, verdict, method: 'program', basis, quotes: [...new Set(quotes)], invalidEvidence: false };
}

// ---------------------------------------------------------------------------
// AI 判斷（依據必須逐字存在於原文）
// ---------------------------------------------------------------------------
const MAX_BODY = 12000;

export function buildCriterionPrompt(c: Criterion, fullText: string): { system: string; user: string } {
  return {
    system: [
      '你是台灣法律研究助理，負責依研究者的納入或排除標準判斷單一判決。',
      '只根據提供的判決原文判斷，不得編造；若原文不足以判斷，verdict 填 "unknown"。',
      '只輸出一個 JSON 物件，格式：{"verdict":"met|not_met|unknown","quotes":["逐字引用原文的句子"],"basis":"一句繁體中文說明"}。',
      'quotes 必須是判決原文中逐字出現的句子（不要改寫、不要省略字）；verdict 為 met 或 not_met 時至少要有一句。',
    ].join('\n'),
    user: `標準（${c.kind === 'include' ? '納入' : '排除'}）：${c.text}\n\n判決原文：\n${fullText.slice(0, MAX_BODY)}`,
  };
}

/**
 * 以 AI 判斷一條標準。AI 服務錯誤（金鑰、額度、網路）原樣拋出，讓整次執行中止；
 * 回覆格式錯誤或依據無法逐字找到，只影響這一條（視為無法判斷），不會把無效依據當成結論。
 */
export async function evaluateByAi(ai: AiComplete, c: Criterion, fullText: string): Promise<CriterionResult> {
  if (!fullText.trim()) {
    return { criterionId: c.id, verdict: 'unknown', method: 'ai', basis: '判決原文為空，無法判斷', quotes: [], invalidEvidence: false };
  }
  const { system, user } = buildCriterionPrompt(c, fullText);
  const raw = await ai(system, user, 600);
  let parsed: { verdict?: unknown; quotes?: unknown; basis?: unknown };
  try {
    parsed = parseJsonReply(raw);
  } catch {
    return { criterionId: c.id, verdict: 'unknown', method: 'ai', basis: 'AI 回覆格式不正確，無法判斷', quotes: [], invalidEvidence: false };
  }
  const basis = typeof parsed.basis === 'string' ? parsed.basis.trim() : '';
  const verdict = parsed.verdict === 'met' || parsed.verdict === 'not_met' ? parsed.verdict : 'unknown';
  if (verdict === 'unknown') {
    return { criterionId: c.id, verdict, method: 'ai', basis: basis || 'AI 表示原文不足以判斷', quotes: [], invalidEvidence: false };
  }
  const quotes = keepVerifiedQuotes(fullText, parsed.quotes);
  if (!quotes.length) {
    return {
      criterionId: c.id,
      verdict: 'unknown',
      method: 'ai',
      basis: 'AI 給出的依據無法在判決原文中逐字找到，已視為無效，改為無法判斷',
      quotes: [],
      invalidEvidence: true,
    };
  }
  return { criterionId: c.id, verdict, method: 'ai', basis: basis || (verdict === 'met' ? '符合標準' : '不符合標準'), quotes, invalidEvidence: false };
}

// ---------------------------------------------------------------------------
// 決定與統計
// ---------------------------------------------------------------------------
/** 單案決定：任一排除條件成立、或任一納入條件不成立 → 排除；有無法判斷 → 需人工檢視；其餘 → 納入。 */
export function decide(criteria: Criterion[], results: CriterionResult[]): CaseDecision {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  let review = false;
  for (const r of results) {
    const c = byId.get(r.criterionId);
    if (!c) continue;
    if (r.verdict === 'unknown') {
      review = true;
      continue;
    }
    if (c.kind === 'exclude' && r.verdict === 'met') return 'exclude';
    if (c.kind === 'include' && r.verdict === 'not_met') return 'exclude';
  }
  return review ? 'review' : 'include';
}

export function summarizeRun(outcomes: CaseOutcome[]): RunSummary {
  const total = outcomes.length;
  const include = outcomes.filter((o) => o.decision === 'include').length;
  const exclude = outcomes.filter((o) => o.decision === 'exclude').length;
  const review = outcomes.filter((o) => o.decision === 'review').length;
  return {
    total,
    include,
    exclude,
    review,
    matchRate: total ? include / total : 0,
    reviewRate: total ? review / total : 0,
    invalidEvidenceCount: outcomes.reduce((n, o) => n + o.results.filter((r) => r.invalidEvidence).length, 0),
  };
}

// ---------------------------------------------------------------------------
// 重新檢索的判斷：由 AI 看過結果摘要後決定（不使用固定門檻）。
// AI 只看摘要（候選數、各標準的符合／不符合／無法判斷次數、無效依據數）與查詢詞，不看判決全文。
// AI 服務錯誤原樣拋出（不靜默決定）；回覆無法判讀時回傳 unclear，明確表示沒有建議。
// ---------------------------------------------------------------------------
export type RerunVerdict = 'ok' | 'rerun' | 'unclear';

export interface RerunReview {
  verdict: RerunVerdict;
  /** verdict 為 rerun 時，AI 提出的新查詢詞（可能沒有）。 */
  query?: string;
  /** AI 給出的簡短理由（若有）。 */
  reason?: string;
  reviewedAt: string;
}

export function buildRerunPrompt(run: Pick<CriteriaRun, 'query' | 'criteria' | 'outcomes' | 'summary'>): { system: string; user: string } {
  const s = run.summary;
  const perCriterion = run.criteria.map((c) => {
    const rs = run.outcomes.flatMap((o) => o.results.filter((r) => r.criterionId === c.id));
    const count = (v: Verdict) => rs.filter((r) => r.verdict === v).length;
    return `- ${c.kind === 'include' ? '納入' : '排除'}：${c.text}（${c.method === 'program' ? '程式判斷' : 'AI 判斷'}）：符合 ${count('met')}、不符合 ${count('not_met')}、無法判斷 ${count('unknown')}`;
  });
  return {
    system: [
      '你是納入／排除核查的檢查員。根據下列摘要，判斷這次的查詢是否需要重新檢索。',
      '若結果大致符合研究目的（候選判決多數與標準相關、可以判斷），回覆 {"ok":true}。',
      '若候選判決大多與標準無關、大多無法判斷，或沒有候選判決，回覆 {"ok":false,"query":"更精準的查詢詞（繁體中文，一行）","reason":"一句理由"}。',
      '只回覆 JSON，不要其他文字。',
    ].join('\n'),
    user: [
      `查詢：${run.query}`,
      `候選 ${s.total} 筆；納入 ${s.include}、排除 ${s.exclude}、需人工檢視 ${s.review}；無效依據 ${s.invalidEvidenceCount} 則。`,
      '各標準的判定次數：',
      ...(perCriterion.length ? perCriterion : ['（沒有標準）']),
    ].join('\n'),
  };
}

/** 解析 AI 回覆：格式不合法回傳 null（呼叫端視為 unclear）。 */
export function parseRerunReply(text: string): { verdict: 'ok' | 'rerun'; query?: string; reason?: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const reason = typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim() : undefined;
  if (o.ok === true) return { verdict: 'ok', reason };
  if (o.ok === false) {
    const query = typeof o.query === 'string' && o.query.trim() ? o.query.trim() : undefined;
    return { verdict: 'rerun', query, reason };
  }
  return null;
}

/** 由 AI 檢閱這次核查是否需要重新檢索。AI 服務錯誤會拋出，由呼叫端明確告知。 */
export async function reviewRerun(ai: AiComplete, run: Pick<CriteriaRun, 'query' | 'criteria' | 'outcomes' | 'summary'>, now: Date = new Date()): Promise<RerunReview> {
  const { system, user } = buildRerunPrompt(run);
  const reply = parseRerunReply(await ai(system, user, 200));
  const reviewedAt = now.toISOString();
  if (!reply) return { verdict: 'unclear', reason: 'AI 回覆無法判讀，沒有重新檢索的建議', reviewedAt };
  return { ...reply, reviewedAt };
}

// ---------------------------------------------------------------------------
// 執行前規劃（顯示 AI 判斷的案件數與估計用量）
// ---------------------------------------------------------------------------
export interface RunPlan {
  total: number;
  /** 程式判斷已排除、因此不需要呼叫 AI 的案件數。 */
  skippedByProgram: number;
  /** 需要呼叫 AI 的案件數（每案會對每條 AI 標準各呼叫一次）。 */
  aiCases: number;
  aiCalls: number;
}

export function planRun(criteria: Criterion[], cases: CaseInput[]): RunPlan {
  const programCriteria = criteria.filter((c) => c.method === 'program');
  const aiCriteria = criteria.filter((c) => c.method === 'ai');
  let skippedByProgram = 0;
  let aiCases = 0;
  for (const cs of cases) {
    const progResults = programCriteria.map((c) => evaluateProgram(c, cs.fullText));
    const decided = decide(programCriteria, progResults);
    if (decided === 'exclude') {
      skippedByProgram++;
      continue;
    }
    if (aiCriteria.length) aiCases++;
  }
  return {
    total: cases.length,
    skippedByProgram,
    aiCases,
    aiCalls: aiCases * aiCriteria.length,
  };
}

// ---------------------------------------------------------------------------
// 執行
// ---------------------------------------------------------------------------
export interface RunOptions {
  ai?: AiComplete;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** 執行一次核查。AI 標準存在但沒有提供 ai 函式時拋錯（不靜默略過）。 */
export async function runCriteria(input: { query: string; criteria: Criterion[]; cases: CaseInput[]; runNo?: number; now?: Date }, opts: RunOptions = {}): Promise<CriteriaRun> {
  const errors = validateCriteria(input.criteria);
  if (errors.length) throw new Error(errors.join('；'));
  const needsAi = input.criteria.some((c) => c.method === 'ai');
  if (needsAi && !opts.ai) throw new Error('有標準需要 AI 判斷，但沒有提供 AI 服務');
  const outcomes: CaseOutcome[] = [];
  let done = 0;
  for (const cs of input.cases) {
    if (opts.signal?.aborted) throw new Error('已取消核查');
    const results: CriterionResult[] = [];
    // 先跑程式判斷；若已確定排除，就不再對這個案件呼叫 AI。
    for (const c of input.criteria.filter((x) => x.method === 'program')) results.push(evaluateProgram(c, cs.fullText));
    const progDecision = decide(input.criteria.filter((c) => c.method === 'program'), results);
    if (progDecision !== 'exclude') {
      for (const c of input.criteria.filter((x) => x.method === 'ai')) {
        results.push(await evaluateByAi(opts.ai as AiComplete, c, cs.fullText));
      }
    }
    const decision = progDecision === 'exclude' ? 'exclude' : decide(input.criteria, results);
    outcomes.push({ id: cs.id, caseNo: cs.caseNo, dateIso: cs.dateIso, decision, results });
    done++;
    opts.onProgress?.(done, input.cases.length);
  }
  return {
    runNo: input.runNo ?? 1,
    createdAt: (input.now ?? new Date()).toISOString(),
    query: input.query,
    criteria: input.criteria,
    outcomes,
    summary: summarizeRun(outcomes),
  };
}

/** 保存多次執行：新的一次編號遞增，既有的紀錄原樣保留（不覆蓋）。 */
export function appendRun(runs: CriteriaRun[], run: Omit<CriteriaRun, 'runNo'>): CriteriaRun[] {
  const next = Math.max(0, ...runs.map((r) => r.runNo)) + 1;
  return [...runs, { ...run, runNo: next }];
}

/** 比較兩次執行：列出決定不同的案件（例如第一次納入、第二次排除）。 */
export function compareRuns(a: CriteriaRun, b: CriteriaRun): { changed: { id: string; caseNo: string | null; from: CaseDecision; to: CaseDecision }[]; onlyInA: string[]; onlyInB: string[] } {
  const ma = new Map(a.outcomes.map((o) => [o.id, o]));
  const mb = new Map(b.outcomes.map((o) => [o.id, o]));
  const changed: { id: string; caseNo: string | null; from: CaseDecision; to: CaseDecision }[] = [];
  for (const [id, oa] of ma) {
    const ob = mb.get(id);
    if (ob && ob.decision !== oa.decision) changed.push({ id, caseNo: oa.caseNo, from: oa.decision, to: ob.decision });
  }
  return {
    changed,
    onlyInA: [...ma.keys()].filter((id) => !mb.has(id)),
    onlyInB: [...mb.keys()].filter((id) => !ma.has(id)),
  };
}

const DECISION_LABEL: Record<CaseDecision, string> = { include: '納入', exclude: '排除', review: '需人工檢視' };
const VERDICT_LABEL: Record<Verdict, string> = { met: '符合', not_met: '不符合', unknown: '無法判斷' };

/** 匯出用的表格：每案一列、每條標準一欄（與範圍整理表可接在一起）。 */
export function toCriteriaTable(run: CriteriaRun): { headers: string[]; rows: string[][] } {
  const headers = ['序號', '案號', '判決日期', '決定', ...run.criteria.map((c) => `${c.kind === 'include' ? '納入' : '排除'}：${c.text}`)];
  const rows = run.outcomes.map((o, i) => {
    const cells = run.criteria.map((c) => {
      const r = o.results.find((x) => x.criterionId === c.id);
      if (!r) return '未判斷';
      const extra = r.invalidEvidence ? '（依據無效）' : '';
      return `${VERDICT_LABEL[r.verdict]}${extra}：${r.basis}`;
    });
    return [String(i + 1), o.caseNo ?? '', o.dateIso ?? '', DECISION_LABEL[o.decision], ...cells];
  });
  return { headers, rows };
}
