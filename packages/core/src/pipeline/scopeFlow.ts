// 標編碼標注工序的流程狀態與按鈕前置條件（純函式，畫面與測試共用）。
// 流程節點依固定順序排列；每個節點的狀態由「目前輸入」與「流程紀錄（trace）或目前執行的階段」決定：
//   未開始（pending）、進行中（running）、完成（done）、失敗（failed，但流程已回退繼續）、略過（skipped）、等待選擇（waiting）。
import type { PipelineTrace, TraceStep } from './trace';
import { describeStep } from './scopeTrace';

export type FlowNodeId = 'input' | 'lookup' | 'search' | 'filter' | 'coding' | 'verify' | 'synthesis';
export type FlowStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'waiting';

/** 流程節點的固定順序與名稱。 */
export const FLOW_NODES: { id: FlowNodeId; label: string }[] = [
  { id: 'input', label: '來源與條件' },
  { id: 'lookup', label: '法名與條文' },
  { id: 'search', label: '搜尋與改寫' },
  { id: 'filter', label: '相關與期間篩選' },
  { id: 'coding', label: 'AI 逐案編碼' },
  { id: 'verify', label: '依據驗證與待覆核' },
  { id: 'synthesis', label: '綜合分析與結果' },
];

/** 使用者目前的輸入（畫面送來）。 */
export interface ScopeFlowInput {
  /** 法規清單（每行一部）。 */
  statutes: string[];
  keyword: string;
  relatedStatute: string;
  /** 只保留引用相關法規的判決（需要關鍵字與相關法規）。 */
  relatedOnly: boolean;
  smart: boolean;
  aiOn: boolean;
  /** 勾選的分析欄位數量。 */
  fieldCount: number;
}

export interface ScopeFlowNode {
  id: FlowNodeId;
  label: string;
  status: FlowStatus;
  /** 最後一步的輸出摘要（完成或失敗時）。 */
  detail: string;
  /** 這個節點實際執行的說明句（來自流程紀錄）。 */
  lines: string[];
}

/** 目前的操作狀態（按鈕前置條件用）。 */
export interface ScopeControlInput extends ScopeFlowInput {
  running: boolean;
  hasResult: boolean;
  hasExplanation: boolean;
}

export interface Gate {
  enabled: boolean;
  /** 停用時的一句話原因；可用時為空字串。 */
  reason: string;
}

const open: Gate = { enabled: true, reason: '' };
const closed = (reason: string): Gate => ({ enabled: false, reason });

const ROUND_STAGE = /^第 \d+ 輪篩選判決$/;

/** 流程紀錄的階段名稱 → 流程節點（沒有對應的回傳 null）。 */
export function scopeNodeForStage(stage: string): FlowNodeId | null {
  if (stage === 'AI 分析設定') return 'input';
  if (stage === '確認法名' || stage === '讀入法規現行條文') return 'lookup';
  if (stage === '讀入法規現行條文與沿革' || stage === '讀入爭點知識庫' || stage === '提議新關鍵字' || stage === '語意確認' || stage === '整理此法規' || stage === '整理關鍵字' || ROUND_STAGE.test(stage)) return 'search';
  if (stage === '相關法規篩選' || stage === '整理篩選結果') return 'filter';
  if (stage === 'AI 逐案編碼' || stage === 'AI 逐案與綜合分析') return 'coding';
  if (stage === '依據逐字驗證' || stage === '待覆核標示') return 'verify';
  if (stage === 'AI 綜合分析') return 'synthesis';
  return null;
}

/** 進度事件的階段名稱 → 流程節點。 */
export function scopeNodeForPhase(phase: string): FlowNodeId | null {
  if (phase === '確認法名與法條沿革') return 'lookup';
  if (phase === '讀入相關法規與爭點' || phase === '篩選判決') return 'search';
  if (phase === 'AI 逐案編碼') return 'coding';
  if (phase === 'AI 綜合分析') return 'synthesis';
  return null;
}

export function scopeInputValid(i: ScopeFlowInput): boolean {
  return i.statutes.some((s) => s.trim() !== '') || i.keyword.trim() !== '';
}

/** 依目前輸入，哪些節點會實際執行（不適用的節點顯示為略過）。 */
export function applicableNodes(i: ScopeFlowInput): Set<FlowNodeId> {
  const out = new Set<FlowNodeId>(['input', 'search', 'filter']);
  if (i.statutes.some((s) => s.trim() !== '')) out.add('lookup');
  if (i.aiOn && i.fieldCount > 0) {
    out.add('coding');
    out.add('verify');
  }
  if (i.aiOn) out.add('synthesis');
  return out;
}

/** 失敗的步驟：明確的「失敗」，或全部案件都失敗的編碼。流程仍會回退繼續，所以節點會標示失敗但不中止。 */
function isFailureStep(s: TraceStep): boolean {
  if (s.output === '失敗') return true;
  if (s.decision === 'skip' && !s.output.includes('已關閉')) return true;
  return /成功 0 筆.*失敗 [1-9]/.test(s.output);
}

function nodeFromTrace(id: FlowNodeId, i: ScopeFlowInput, steps: TraceStep[]): ScopeFlowNode {
  const label = FLOW_NODES.find((n) => n.id === id)?.label ?? id;
  const lines = steps.map(describeStep).filter((x): x is string => !!x);
  const last = steps[steps.length - 1];
  const detail = last ? last.output.slice(0, 40) : '';
  if (steps.length === 0) {
    // 完成後沒有任何紀錄：適用但沒有執行（例如 AI 關閉）或不適用，一律視為略過。
    return { id, label, status: id === 'input' && scopeInputValid(i) ? 'done' : 'skipped', detail: '', lines };
  }
  let status: FlowStatus = 'done';
  if (steps.some(isFailureStep)) status = 'failed';
  else if (steps.some((s) => s.decision === 'ask')) status = 'waiting';
  return { id, label, status, detail, lines };
}

/**
 * 流程節點與狀態。
 * - 有 trace（執行結束）：依紀錄判斷每個節點完成、失敗、等待選擇或略過。
 * - running（執行中）：目前階段為進行中，之前的適用節點為完成，之後的為未開始。
 * - 都沒有（尚未執行）：依輸入判斷，適用的為未開始，不適用的為略過。
 */
export function scopeFlowNodes(i: ScopeFlowInput, opts: { running?: string | null; trace?: PipelineTrace | null } = {}): ScopeFlowNode[] {
  const applicable = applicableNodes(i);
  if (opts.trace) {
    const trace = opts.trace;
    return FLOW_NODES.map((n) => nodeFromTrace(n.id, i, trace.steps.filter((s) => scopeNodeForStage(s.stage) === n.id)));
  }
  const current = opts.running ? scopeNodeForPhase(opts.running) ?? 'search' : null;
  let reached = false;
  return FLOW_NODES.map((n) => {
    const base = { id: n.id, label: n.label, detail: '', lines: [] as string[] };
    if (n.id === 'input') return { ...base, status: scopeInputValid(i) || current ? 'done' : 'pending' } as ScopeFlowNode;
    if (current) {
      if (n.id === current) {
        reached = true;
        return { ...base, status: 'running' } as ScopeFlowNode;
      }
      if (!reached) return { ...base, status: applicable.has(n.id) ? 'done' : 'skipped' } as ScopeFlowNode;
      return { ...base, status: applicable.has(n.id) ? 'pending' : 'skipped' } as ScopeFlowNode;
    }
    return { ...base, status: applicable.has(n.id) ? 'pending' : 'skipped' } as ScopeFlowNode;
  });
}

/**
 * 按鈕與輸入欄位的前置條件。每個停用的控制項都附一句話原因，畫面直接顯示。
 */
export function scopeControlStates(i: ScopeControlInput) {
  const hasInput = scopeInputValid(i);
  const hasKeyword = i.keyword.trim() !== '';
  const hasRelated = i.relatedStatute.trim() !== '';
  const busy = '整理進行中，請等候完成或按「取消」';
  const run: Gate = i.running ? closed(busy)
    : !hasInput ? closed('請先輸入關鍵字，或至少一部法規')
    : i.aiOn && i.fieldCount === 0 ? closed('請至少勾選一個分析欄位，或關閉 AI 分析')
    : i.relatedOnly && !hasRelated ? closed('只保留相關法規的判決，需要先填相關法規')
    : open;
  return {
    run,
    /** 取消只在執行中可用。 */
    cancel: i.running ? open : closed('目前沒有進行中的工作'),
    /** 輸入欄位與勾選框：執行中全部停用。 */
    input: i.running ? closed(busy) : open,
    smart: i.running ? closed(busy) : !hasKeyword ? closed('智慧搜尋需要先輸入關鍵字') : open,
    relatedOnly: i.running ? closed(busy) : !hasRelated ? closed('需要先填相關法規') : !hasKeyword ? closed('只作用於關鍵字，需要先輸入關鍵字') : open,
    /** 匯出與精讀：需要結果，且不在執行中。 */
    exportFile: i.running ? closed('整理完成後才能匯出') : !i.hasResult ? closed('尚未有結果，請先開始整理') : open,
    /** 查看處理流程：執行中可看即時進度；執行結束後看完整紀錄。 */
    explain: i.running || i.hasExplanation ? open : closed('尚未執行，沒有處理流程可以查看'),
    brief: i.running ? closed(busy) : !i.hasResult ? closed('尚未有結果') : open,
    /** 分析欄位的新增、排序、移除：執行中停用。 */
    fieldEdit: i.running ? closed(busy) : open,
  };
}

/** 畫面需要的全部狀態：按鈕前置條件與尚未執行時的流程。 */
export function scopeUiState(i: ScopeControlInput) {
  return { gates: scopeControlStates(i), flow: scopeFlowNodes(i) };
}
