// 標編碼標注工序（範圍整理表，v3.6.0；v3.8 起加入關鍵字入口與分析欄位）：
//   法規清單（每行一部）與／或關鍵字（支援自然語言與智慧搜尋，相關法規只作為 AI 的上下文，與判決列表相同）
//   → 法名確認（有候選時請使用者選）→ 法條沿革與現行條文 → 篩選判決（有上限的重試，AI 可提議關鍵字）
//   → 逐案 AI 編碼（依勾選的分析欄位批次產生，每個欄位附逐字依據；無效依據標示待覆核）→ 綜合分析 → 存入檔案管理。
// 容錯：每部法規、每個關鍵字獨立（一部失敗不影響其他部）；內頁逐筆容錯；取消時保留已完成的部分；存檔失敗仍回傳結果。
// 每一步都寫入流程紀錄（PipelineTrace），供畫面的說明視窗顯示實際經過的處理。
import {
  jurisdictionRegistry, buildScopeTable, CourtClient, analyzeCase, synthesizeScope, proposeQueries,
  currentTextForCitations, settleEach, newTrace, addStep, explainTrace, runQueryRounds, buildLawContext, buildClarifyOptions,
  raceAbort, isCancelError, normalizeCodingFields, DEFAULT_CODING_FIELDS, countPendingReview,
  type CitationRef, type CodingField, type CodingFieldInput,
  type CaseAnalysis, type ClarifyOption, type CurrentLaw, type HistoryArticle, type PipelineTrace, type ScopeRow, type ScopeSynthesis, type AiComplete,
  type TraceExplanation,
} from '@judge/core';
import type { ScopeSheet } from '../scopeExporters';
import { resolveStatuteOrCandidates, lawHistoryFor, currentLawFor } from '../data/cloud/lawRepo';
import { cachedDetail, cachedSearch } from '../data/cloud/courtRepo';
import { splitStatuteLine, rowCites } from './statuteInput';
import { lawContextForStatute } from './lawContext';
import { knowledgeContextWithReview } from './knowledgeService';
import { saveToLibrary } from './savedResult';
import { toUserError } from './userError';

export const SCOPE_MAX_ROUNDS = 3;

export interface ScopeRunArgs {
  /** 法規清單，每行一部（可含條項款）。與關鍵字可併用，兩者皆空時不執行。 */
  statutes: string[];
  /** 關鍵字（支援自然語言）：搜尋結果全部列出，不以法規篩選。 */
  keyword?: string;
  /** 相關法規（選填）：與判決列表相同，智慧搜尋時 AI 會先讀入其現行條文與沿革。 */
  relatedStatute?: string;
  /** 只保留引用相關法規的判決（預設關閉，與判決列表一致；開啟時關鍵字結果以相關法規篩選）。 */
  relatedOnly?: boolean;
  /** 智慧搜尋：AI 依結果調整關鍵字，最多 SCOPE_MAX_ROUNDS 輪（未設定 AI 時只查一次）。只作用於關鍵字。 */
  smart?: boolean;
  /** 分析欄位：勾選的欄位（含自訂），順序即欄位順序；未提供時使用預設欄位。 */
  fields?: CodingFieldInput[];
  yearFrom?: number;
  yearTo?: number;
  maxItems: number;
  /** 法院管轄區；未指定為台灣司法院。法規名稱確認與法條沿革目前只支援台灣法規資料庫。 */
  jurisdiction?: string;
  /** AI 來源：auto、local、cloud（見 aiRepo）。 */
  ai?: string;
  /** 是否進行 AI 分析（逐案編碼與綜合）。關閉時只做傳統篩選。預設開啟。 */
  aiAnalysis?: boolean;
}

export interface ScopeProgress {
  statute: string;
  done: number;
  total: number;
  phase: string;
}

export interface ScopeRunDone {
  status: 'done';
  sheets: ScopeSheet[];
  notes: string[];
  /** 使用者取消時為 true；sheets 為取消前已完成的部分。 */
  cancelled: boolean;
  /** 存入檔案管理失敗時的說明；結果仍在 sheets 中。 */
  saveError: string | null;
  trace: PipelineTrace;
  explanation: TraceExplanation;
}

/** 法名有多個候選：回傳選項，畫面讓使用者選；選定後以選項文字重新執行（issue #4 第 3 點）。 */
export interface ScopeRunAsk {
  status: 'ask';
  /** 要更正的輸入欄位：statute 為法規清單的那一行，keyword 為關鍵字欄位。 */
  target: 'statute' | 'keyword';
  /** 需要使用者選擇的那一行（法規）或關鍵字（原始輸入）。 */
  statuteLine: string;
  question: string;
  options: ClarifyOption[];
  notes: string[];
  trace: PipelineTrace;
  explanation: TraceExplanation;
}

export type ScopeRunResult = ScopeRunDone | ScopeRunAsk;

/** 工作名稱與檔案標題：法規與關鍵字合併顯示。 */
export function scopeTitle(args: { statutes: string[]; keyword?: string }): string {
  const parts = [...args.statutes, ...(args.keyword?.trim() ? [`關鍵字：${args.keyword.trim()}`] : [])];
  return parts.join('、') || '範圍整理';
}

/** 依判決引用的條文，從現行條文取出對應段落；找不到時回傳 undefined（不猜）。 */
export function currentTextFor(law: CurrentLaw, cited: string[]): string | undefined {
  return currentTextForCitations(law, cited);
}

interface RunCtx {
  args: ScopeRunArgs;
  ai: AiComplete | null;
  aiOn: boolean;
  client: CourtClient;
  signal?: AbortSignal;
  notes: string[];
  trace: PipelineTrace;
  onProgress: (p: ScopeProgress) => void;
  fields: CodingField[];
}

export async function runScope(
  args: ScopeRunArgs,
  ai: AiComplete | null,
  onProgress: (p: ScopeProgress) => void,
  signal?: AbortSignal,
): Promise<ScopeRunResult> {
  const sheets: ScopeSheet[] = [];
  const notes: string[] = [];
  const trace = newTrace('範圍整理');
  const keyword = (args.keyword ?? '').trim();
  const relatedStatute = (args.relatedStatute ?? '').trim();
  if (args.statutes.length === 0 && !keyword) throw new Error('請輸入法規或關鍵字');
  const client = new CourtClient({ signal });
  const aiOn = args.aiAnalysis !== false && ai !== null;
  if (args.aiAnalysis !== false && ai === null) notes.push('未設定可用的 AI，已改為傳統篩選（不做 AI 分析與自動換關鍵字）。');
  const fields = normalizeCodingFields(args.fields ?? DEFAULT_CODING_FIELDS);
  if (aiOn && fields.length === 0) throw new Error('請至少勾選一個分析欄位');
  addStep(trace, {
    stage: 'AI 分析設定', module: 'rule', input: aiOn ? '啟用' : '關閉',
    output: aiOn ? `逐案編碼（${fields.map((f) => f.name).join('、')}）與綜合分析、自動換關鍵字皆啟用` : '只做傳統篩選',
    decision: 'pass', reason: aiOn ? '使用者啟用 AI 分析' : '使用者關閉 AI 分析或沒有可用的 AI',
  });
  const ctx: RunCtx = { args, ai, aiOn, client, signal, notes, trace, onProgress, fields };

  for (const line of args.statutes) {
    if (signal?.aborted) break;
    const { name, citation } = splitStatuteLine(line);
    try {
      const outcome = await runOneStatute(ctx, { line, name, citation });
      if (outcome.kind === 'ask') {
        return { status: 'ask', target: 'statute', statuteLine: line, question: outcome.question, options: outcome.options, notes, trace, explanation: explainTrace(trace) };
      }
      sheets.push(outcome.sheet);
    } catch (err) {
      if (signal?.aborted) break;
      // 單一法規失敗：記錄原因，其餘法規照常處理。
      const msg = toUserError(err).message;
      notes.push(`「${name}」整理失敗：${msg}`);
      addStep(trace, { stage: '整理此法規', module: 'rule', input: name, output: '失敗', decision: 'skip', reason: msg });
    }
  }

  if (keyword && !signal?.aborted) {
    try {
      const kw = await runKeywordSheet(ctx, keyword, relatedStatute);
      if (kw.kind === 'ask') {
        return { status: 'ask', target: 'keyword', statuteLine: keyword, question: kw.question, options: kw.options, notes, trace, explanation: explainTrace(trace) };
      }
      sheets.push(kw.sheet);
    } catch (err) {
      if (signal?.aborted) throw err;
      const msg = toUserError(err).message;
      notes.push(`「關鍵字：${keyword}」整理失敗：${msg}`);
      addStep(trace, { stage: '整理關鍵字', module: 'rule', input: keyword, output: '失敗', decision: 'skip', reason: msg });
    }
  }

  const cancelled = !!signal?.aborted;
  if (cancelled) addStep(trace, { stage: '取消', module: 'user', input: '使用者要求取消', output: `保留 ${sheets.length} 部的已完成部分`, decision: 'stop', reason: '使用者取消，輸出取消前已完成的結果' });
  const total = sheets.reduce((n, sh) => n + sh.rows.length, 0);
  const save = await saveToLibrary({
    kind: 'scope',
    title: `範圍整理：${scopeTitle(args)}`,
    summary: `${sheets.length} 部，共 ${total} 筆${cancelled ? '（已取消，部分結果）' : ''}`,
    payload: { sheets, yearFrom: args.yearFrom, yearTo: args.yearTo, trace },
  });
  return { status: 'done', sheets, notes, cancelled, saveError: save.saveError, trace, explanation: explainTrace(trace) };
}

type OneStatuteOutcome = { kind: 'sheet'; sheet: ScopeSheet } | { kind: 'ask'; question: string; options: ClarifyOption[] };

/** 依期間篩選（西元年）；沒有日期的判決保留。 */
function filterYears(rows: ScopeRow[], args: ScopeRunArgs): ScopeRow[] {
  if (!args.yearFrom && !args.yearTo) return rows;
  return rows.filter((r) => {
    const y = r.dateIso ? Number(r.dateIso.slice(0, 4)) : null;
    if (y === null) return true;
    if (args.yearFrom && y < args.yearFrom) return false;
    if (args.yearTo && y > args.yearTo) return false;
    return true;
  });
}

interface SearchPlan {
  /** 顯示名稱（法規名稱或關鍵字）：進度與說明使用。 */
  label: string;
  /** 交給 AI 提議關鍵字時的需求說明。 */
  request: string;
  initialQuery: string;
  /** 引用比對用的法規名稱；關鍵字模式為空字串。 */
  statute: string;
  keywordMode: boolean;
  citation: CitationRef | null;
  lawHistory: HistoryArticle[];
  lawContext?: string;
  maxRounds: number;
}

type SearchOutcome = { rows: ScopeRow[]; ask: { question: string; options: ClarifyOption[] } | null; advice: string | null };

/** 有上限的關鍵字輪次篩選（法規與關鍵字共用）。 */
async function searchRows(ctx: RunCtx, plan: SearchPlan): Promise<SearchOutcome> {
  const { args, ai, aiOn, client, signal, notes, trace, onProgress } = ctx;
  const search = async (q: string): Promise<ScopeRow[]> => {
    const rows = await buildScopeTable({
      statute: plan.statute,
      keywordMode: plan.keywordMode,
      searchQuery: q,
      yearFrom: args.yearFrom,
      yearTo: args.yearTo,
      maxItems: args.maxItems,
      client,
      jurisdiction: args.jurisdiction,
      lawHistory: plan.lawHistory,
      signal,
      // 繼承快取（v3.6.1）：列表或前一階段已取得的搜尋與內頁直接使用，不重複爬取。
      searchSource: (query, max) => cachedSearch(query, max, undefined, args.jurisdiction),
      detailSource: (id) => cachedDetail(id, client, args.jurisdiction),
      onItemError: (id, title, err) => notes.push(`「${title || id}」內頁取得失敗，已略過：${toUserError(err).message}`),
      onProgress: (done, total) => onProgress({ statute: plan.label, done, total, phase: '篩選判決' }),
    });
    return plan.citation ? rows.filter((r) => rowCites(r, plan.citation as CitationRef)) : rows;
  };
  const rounds = await runQueryRounds<ScopeRow>({
    feature: '篩選判決',
    trace,
    module: aiOn ? 'ai' : 'rule',
    initialQueries: [plan.initialQuery],
    maxRounds: aiOn ? plan.maxRounds : 1,
    signal,
    search,
    keyOf: (r) => r.id,
    onError: (q, err) => notes.push(`搜尋「${q}」失敗：${toUserError(err).message}`),
    onProposeError: (err) => notes.push(`AI 無法提議新關鍵字：${toUserError(err).message}`),
    propose: async ({ tried, kept, round }) => {
      if (!ai || !aiOn) return { unclear: false, queries: [], reason: '未使用 AI，不自動換關鍵字' };
      return raceAbort(proposeQueries(ai, { request: plan.request, tried, keptCount: kept.length, round, lawContext: plan.lawContext }), signal);
    },
  });
  if (rounds.status === 'ask') return { rows: rounds.items, ask: { question: rounds.question, options: rounds.options }, advice: null };
  return { rows: rounds.items, ask: null, advice: rounds.status === 'capped' ? rounds.advice : null };
}

/**
 * 逐案 AI 編碼與綜合分析。欄位依設定一次交給 AI；內容或依據不全的欄位會計入待覆核（說明中提示）。
 * 單一案件失敗只記錄；取消時停在目前案件之後。
 */
async function analyzeRows(ctx: RunCtx, label: string, rows: ScopeRow[], currentLaw: CurrentLaw | null): Promise<{ analyses: CaseAnalysis[]; synthesis: ScopeSynthesis | null }> {
  const { ai, aiOn, client, signal, notes, trace, onProgress, args, fields } = ctx;
  if (!(aiOn && ai)) {
    addStep(trace, { stage: 'AI 逐案與綜合分析', module: 'rule', input: `${rows.length} 筆判決`, output: '已關閉，只輸出傳統篩選結果', decision: 'skip', reason: '使用者關閉 AI 分析' });
    return { analyses: [], synthesis: null };
  }
  const { results, failures, cancelled } = await settleEach(
    rows,
    async (row) => {
      const d = await cachedDetail(row.id, client, args.jurisdiction);
      const currentText = currentLaw ? currentTextForCitations(currentLaw, row.citedArticles) : undefined;
      return analyzeCase(ai, label, row, d, { currentText, fields });
    },
    (done, total) => onProgress({ statute: label, done, total, phase: 'AI 逐案編碼' }),
    signal,
  );
  for (const f of failures) notes.push(`「${f.item.title}」逐案分析失敗（${f.message}），已保留其他判決。`);
  const pending = countPendingReview(results);
  if (pending) notes.push(`「${label}」有 ${pending} 格編碼待覆核（依據無法在判決原文中找到，或內容未取得）。`);
  addStep(trace, { stage: 'AI 逐案編碼', module: 'cloud', input: `${rows.length} 筆判決，${fields.length} 個欄位`, output: `成功 ${results.length} 筆，失敗 ${failures.length} 筆，待覆核 ${pending} 格${cancelled ? '，已取消' : ''}`, decision: 'pass', reason: failures.length ? '失敗的案件已記錄，其餘照常生成' : '全部案件編碼完成' });

  let synthesis: ScopeSynthesis | null = null;
  if (!signal?.aborted) {
    onProgress({ statute: label, done: 1, total: 1, phase: 'AI 綜合分析' });
    if (results.length) {
      try {
        synthesis = await raceAbort(synthesizeScope(ai, label, results), signal);
        addStep(trace, { stage: 'AI 綜合分析', module: 'cloud', input: `${results.length} 則逐案分析`, output: '完成', decision: 'pass', reason: '跨案綜合完成，放行生成' });
      } catch (err) {
        if (isCancelError(err)) throw err;
        const msg = toUserError(err).message;
        notes.push(`「${label}」綜合分析失敗：${msg}`);
        addStep(trace, { stage: 'AI 綜合分析', module: 'cloud', input: `${results.length} 則逐案分析`, output: '失敗', decision: 'skip', reason: msg });
      }
    }
  }
  return { analyses: results, synthesis };
}

async function runOneStatute(ctx: RunCtx, p: { line: string; name: string; citation: CitationRef | null | undefined }): Promise<OneStatuteOutcome> {
  const { args, notes, trace, onProgress } = ctx;
  const { line, name, citation } = p;
  onProgress({ statute: name, done: 0, total: 1, phase: '確認法名與法條沿革' });
  // 只有支援法規查詢的管轄區（台灣）才做法名確認與法條沿革；其他管轄區以輸入的名稱直接搜尋。
  const lookup = jurisdictionRegistry.get(args.jurisdiction).statuteLookup;
  let statute: { name: string; pcode: string; note?: string } = { name, pcode: '' };
  if (lookup) {
    const r = await resolveStatuteOrCandidates(name);
    if (r.status === 'candidates') {
      const options = buildClarifyOptions(r.candidates.map((c) => ({ label: c, description: '全國法規資料庫的正式法名' })));
      addStep(trace, { stage: '確認法名', module: 'rule', input: name, output: `候選：${r.candidates.join('、')}`, decision: 'ask', reason: '法名有多個候選，請使用者選擇' });
      return { kind: 'ask', question: `「${name}」有多個可能的法規，請選擇要整理的正式法名：`, options };
    }
    statute = { name: r.name, pcode: r.pcode, note: r.note };
  }
  if (statute.note) notes.push(statute.note);
  addStep(trace, { stage: '確認法名', module: 'rule', input: name, output: statute.name, decision: 'pass', reason: statute.note ?? '法名確認完成' });

  // 法條沿革失敗不影響篩選：記錄後以空沿革繼續（issue #4 第 4 點的資料缺口會在結果說明中呈現）。
  let lawHistory: HistoryArticle[] = [];
  if (lookup) {
    try {
      lawHistory = await lawHistoryFor(statute.name);
    } catch (err) {
      notes.push(`「${statute.name}」法條沿革取得失敗，已略過沿革比對：${toUserError(err).message}`);
    }
  }
  // 現行條文（issue #4 第 4 點）：取得失敗只記錄，AI 改依判決原文判讀。
  let currentLaw: CurrentLaw | null = null;
  if (lookup && statute.pcode) {
    try {
      currentLaw = await currentLawFor(statute.pcode);
      addStep(trace, { stage: '讀入法規現行條文', module: 'rule', input: statute.name, output: `${currentLaw.articles.length} 條`, decision: 'pass', reason: '現行條文已讀入，篩選與分析時對照' });
    } catch (err) {
      const msg = toUserError(err).message;
      notes.push(`「${statute.name}」現行條文取得失敗，AI 只依判決原文判讀：${msg}`);
      addStep(trace, { stage: '讀入法規現行條文', module: 'rule', input: statute.name, output: '失敗', decision: 'skip', reason: msg });
    }
  }
  const lawContext = buildLawContext({ statuteName: statute.name, law: currentLaw, history: lawHistory }).text;

  // 篩選判決：第一輪用法名；結果不足時（AI 啟用時）由 AI 依法規上下文提議新關鍵字，最多 SCOPE_MAX_ROUNDS 輪。
  const found = await searchRows(ctx, {
    label: statute.name,
    request: `${statute.name}（判決中確實引用該法規）`,
    initialQuery: statute.name,
    statute: statute.name,
    keywordMode: false,
    citation: citation ?? null,
    lawHistory,
    lawContext,
    maxRounds: SCOPE_MAX_ROUNDS,
  });
  if (found.ask) return { kind: 'ask', question: found.ask.question, options: found.ask.options };
  if (found.advice) notes.push(`「${statute.name}」${found.advice}`);
  const rows = filterYears(found.rows, args);
  addStep(trace, { stage: '整理篩選結果', module: 'rule', input: `${statute.name}${citation ? `（${citation}）` : ''}`, output: `${rows.length} 筆`, decision: 'pass', reason: '只保留判決中確實引用該法規的案件' });

  const { analyses, synthesis } = await analyzeRows(ctx, statute.name, rows, currentLaw);
  return {
    kind: 'sheet',
    sheet: { statute: citation ? `${statute.name}${line.trim().slice(name.length)}` : statute.name, rows, analyses, synthesis, fields: ctx.fields },
  };
}

/**
 * 關鍵字整理（與判決列表相同的入口）：自然語言關鍵字、可選的智慧搜尋與相關法規。
 * 相關法規只作為 AI 的上下文（現行條文與沿革）；搜尋結果不以它篩選。語意不清或達上限時，以目前找到的結果整理並說明。
 */
type KeywordOutcome = { kind: 'sheet'; sheet: ScopeSheet } | { kind: 'ask'; question: string; options: ClarifyOption[] };

async function runKeywordSheet(ctx: RunCtx, keyword: string, relatedStatute: string): Promise<KeywordOutcome> {
  const { args, ai, notes, trace, onProgress, signal } = ctx;
  const label = relatedStatute ? `關鍵字：${keyword}（相關法規：${relatedStatute}）` : `關鍵字：${keyword}`;
  onProgress({ statute: label, done: 0, total: 1, phase: '讀入相關法規與爭點' });
  let lawContext: string | undefined;
  if (relatedStatute) {
    try {
      const lc = await lawContextForStatute(relatedStatute);
      if (lc.text) lawContext = lc.text;
      notes.push(...lc.notes);
      addStep(trace, { stage: '讀入法規現行條文與沿革', module: 'rule', input: relatedStatute, output: lc.text ? '已讀入' : '未取得', decision: 'pass', reason: lc.notes.length ? lc.notes.join('；') : '法規內容已交給 AI 提議關鍵字' });
    } catch (err) {
      notes.push(`「${relatedStatute}」相關法規內容取得失敗：${toUserError(err).message}`);
    }
  }
  // 爭點知識庫：與判決列表智慧搜尋相同，依查詢挑出相關爭點交給 AI 參考。
  const kc = await knowledgeContextWithReview(ai, `${keyword} ${relatedStatute}`.trim());
  if (kc.text) lawContext = [lawContext, kc.text].filter(Boolean).join('\n\n');
  addStep(trace, {
    stage: '讀入爭點知識庫', module: 'rule', input: keyword,
    output: kc.usedIds.length ? `${kc.usedIds.length} 個爭點` : '未取得', decision: 'pass',
    reason: kc.notes.length ? kc.notes.join('；') : '相關爭點已交給 AI 參考',
  });

  // 只保留引用相關法規的判決（需使用者開啟）；否則不做法規篩選，與判決列表一致。
  const relatedOnly = !!(relatedStatute && args.relatedOnly);
  const found = await searchRows(ctx, {
    label,
    request: relatedStatute ? `${keyword}（相關法規：${relatedStatute}）` : keyword,
    initialQuery: keyword,
    statute: relatedOnly ? relatedStatute : '',
    keywordMode: !relatedOnly,
    citation: null,
    lawHistory: [],
    lawContext,
    maxRounds: args.smart ? SCOPE_MAX_ROUNDS : 1,
  });
  // 語意不清：與法名相同，提供候選讓使用者選定後重新執行（關鍵字欄位會被替換）。
  if (found.ask) return { kind: 'ask', question: found.ask.question, options: found.ask.options };
  if (found.advice) notes.push(`「${label}」${found.advice}`);
  if (signal?.aborted) {
    return { kind: 'sheet', sheet: { statute: label, rows: [], analyses: [], synthesis: null, fields: ctx.fields } };
  }
  const rows = filterYears(found.rows, args);
  addStep(trace, { stage: '整理篩選結果', module: 'rule', input: label, output: `${rows.length} 筆`, decision: 'pass', reason: relatedOnly ? `只保留引用「${relatedStatute}」的判決` : '關鍵字搜尋結果全部列出（不以法規篩選）' });
  const { analyses, synthesis } = await analyzeRows(ctx, label, rows, null);
  return { kind: 'sheet', sheet: { statute: label, rows, analyses, synthesis, fields: ctx.fields } };
}
