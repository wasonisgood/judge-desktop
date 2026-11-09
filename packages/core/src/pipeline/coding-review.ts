// 標編碼工序的信心與人工覆核規則（純函式，不做 I/O）。
// 規則（依序判斷，第一個成立的決定結果）：
//   1. 內容為空                      → 待覆核（未取得內容）
//   2. 內容是「無法判斷」等標記        → 待覆核（AI 自己表示判決原文無法判斷）
//   3. 沒有有效依據                  → 待覆核（無依據，或提出的依據都不在判決原文中）
//   4. 被丟棄的依據超過門檻           → 待覆核（部分依據不在原文中）
//   5. 有效依據少於門檻               → 待覆核（依據不足）
//   6. 其餘                          → 可接受（reviewStatus 為 none，不需人工覆核）
// 覆核操作（接受、修改、駁回、批次接受、還原）也在這裡實作，回傳新物件，不改動輸入；每次操作都保留操作前的值。
import type { CodedValue, ReviewStatus } from './coding';

/** 覆核規則的門檻（可在設定中調整；預設值見 DEFAULT_REVIEW_POLICY）。 */
export interface CodingReviewPolicy {
  /**
   * 至少需要幾則有效依據（逐字存在於判決原文中）才算可接受。預設 1。
   * 理由：提示詞要求每欄 1 到 2 句逐字依據，至少一則能在原文中找到，就能回溯內容的來源；
   * 設為 2 會把只有一句依據、但依據正確的結果也列入覆核，覆核量明顯增加。
   */
  minEvidence: number;
  /**
   * 允許被丟棄（不在原文中）的依據數量。預設 0。
   * 理由：AI 引用了不存在於判決中的句子，代表它沒有忠實依照原文作答，這是最需要人工確認的跡象；
   * 因此預設任何一則無效依據都要覆核。若覺得覆核量太大，可放寬為 1，但會漏掉部分不實引用。
   */
  maxDroppedEvidence: number;
  /** 視為「無法判斷」的內容開頭文字。預設涵蓋提示詞要求的「判決原文未載明」與常見的「無法判斷」。 */
  unknownMarkers: string[];
}

export const DEFAULT_REVIEW_POLICY: CodingReviewPolicy = {
  minEvidence: 1,
  maxDroppedEvidence: 0,
  unknownMarkers: ['無法判斷', '判決原文未載明'],
};

/** 清理設定值：門檻必須是 0 到 10 的整數，標記去除空白與重複；缺漏的欄位使用預設值。 */
export function normalizeReviewPolicy(input: Partial<CodingReviewPolicy> | null | undefined): CodingReviewPolicy {
  const int = (v: unknown, fallback: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
  };
  const markers = Array.isArray(input?.unknownMarkers)
    ? [...new Set(input!.unknownMarkers.map((m) => String(m ?? '').trim()).filter(Boolean))]
    : DEFAULT_REVIEW_POLICY.unknownMarkers;
  return {
    minEvidence: int(input?.minEvidence, DEFAULT_REVIEW_POLICY.minEvidence, 10),
    maxDroppedEvidence: int(input?.maxDroppedEvidence, DEFAULT_REVIEW_POLICY.maxDroppedEvidence, 10),
    unknownMarkers: markers.length ? markers : DEFAULT_REVIEW_POLICY.unknownMarkers,
  };
}

export interface ReviewInput {
  value: string;
  evidence: string[];
  /** 被丟棄（不在原文中）的依據數量。 */
  dropped: number;
}

export interface ReviewDecision {
  reviewStatus: 'none' | 'pending';
  reviewNote?: string;
}

/** 依規則判斷單一欄位是否需要覆核。 */
export function decideReview(input: ReviewInput, policy: CodingReviewPolicy = DEFAULT_REVIEW_POLICY): ReviewDecision {
  const value = input.value.trim();
  if (!value) return { reviewStatus: 'pending', reviewNote: '未取得內容' };
  if (policy.unknownMarkers.some((m) => value.startsWith(m))) {
    return { reviewStatus: 'pending', reviewNote: 'AI 回答無法判斷（判決原文未載明）' };
  }
  if (input.evidence.length === 0) {
    return {
      reviewStatus: 'pending',
      reviewNote: input.dropped > 0
        ? `依據無效：AI 提出的 ${input.dropped} 則依據都不在判決原文中`
        : '無依據：AI 沒有提出依據',
    };
  }
  if (input.dropped > policy.maxDroppedEvidence) {
    return { reviewStatus: 'pending', reviewNote: `已移除 ${input.dropped} 則無法在判決原文中找到的依據` };
  }
  if (input.evidence.length < policy.minEvidence) {
    return { reviewStatus: 'pending', reviewNote: `有效依據 ${input.evidence.length} 則，低於門檻 ${policy.minEvidence} 則` };
  }
  return { reviewStatus: 'none' };
}

/** 高信心結果：系統判定可接受、尚未經人工確認，且有效依據達門檻。批次接受只作用於這類結果。 */
export function isHighConfidence(v: CodedValue, policy: CodingReviewPolicy = DEFAULT_REVIEW_POLICY): boolean {
  return v.reviewStatus === 'none'
    && v.value.trim().length > 0
    && v.evidence.length >= policy.minEvidence
    && v.droppedEvidence <= policy.maxDroppedEvidence;
}

// ---------------------------------------------------------------------------
// 覆核操作
// ---------------------------------------------------------------------------

/** 一次覆核操作在欄位上留下的紀錄：保存操作前的內容與狀態，供還原。 */
export interface ReviewStep {
  action: 'accept' | 'edit' | 'reject' | 'batch-accept';
  /** ISO 時間。 */
  at: string;
  before: { value: string; reviewStatus: ReviewStatus; reviewNote?: string };
}

/** 欄位的位置（案件 id ＋ 欄位 id），用於畫面的還原清單與寫回。 */
export interface CellRef {
  sheetIndex: number;
  caseId: string;
  fieldId: string;
}

export type ReviewOp =
  | { kind: 'accept'; cell: CellRef }
  | { kind: 'edit'; cell: CellRef; value: string }
  | { kind: 'reject'; cell: CellRef }
  | { kind: 'batch-accept'; sheetIndex: number }
  | { kind: 'undo'; cells: CellRef[] };

/** 審查用的最小結構：只需要 analyses 與各欄位的 values，其他欄位原樣保留。 */
export interface ReviewableSheet {
  analyses?: { id: string; values?: CodedValue[] }[];
}

function snapshot(v: CodedValue): ReviewStep['before'] {
  return { value: v.value, reviewStatus: v.reviewStatus, reviewNote: v.reviewNote };
}

/** 對單一欄位做一次覆核（回傳新物件）。 */
export function reviewValue(v: CodedValue, action: ReviewStep['action'], at: string, newValue?: string): CodedValue {
  const step: ReviewStep = { action, at, before: snapshot(v) };
  const history = [...(v.reviewHistory ?? []), step];
  if (action === 'accept' || action === 'batch-accept') {
    return { ...v, reviewStatus: 'accepted', reviewHistory: history };
  }
  if (action === 'reject') {
    return { ...v, reviewStatus: 'rejected', reviewHistory: history };
  }
  // 修改：保留 AI 原文（第一次修改時記錄），新內容視為已由人工確認。
  const value = (newValue ?? '').trim();
  return {
    ...v,
    value,
    aiValue: v.aiValue ?? v.value,
    reviewStatus: 'accepted',
    reviewHistory: history,
  };
}

/** 還原最近一次操作：回到操作前的內容與狀態；沒有紀錄時原樣回傳。 */
export function undoReview(v: CodedValue): CodedValue {
  const history = v.reviewHistory ?? [];
  if (history.length === 0) return v;
  const last = history[history.length - 1];
  const rest = history.slice(0, -1);
  const restored: CodedValue = {
    ...v,
    value: last.before.value,
    reviewStatus: last.before.reviewStatus,
    reviewNote: last.before.reviewNote,
    reviewHistory: rest.length ? rest : undefined,
  };
  // 所有修改都已還原時，AI 原文紀錄也一併清除。
  if (!rest.some((s) => s.action === 'edit')) delete restored.aiValue;
  return restored;
}

/** 統計一張表的覆核狀態（畫面的篩選與標題列使用）。 */
export interface ReviewSummary {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  highConfidence: number;
}

export function summarizeReview(sheet: ReviewableSheet, policy: CodingReviewPolicy = DEFAULT_REVIEW_POLICY): ReviewSummary {
  const s: ReviewSummary = { total: 0, pending: 0, accepted: 0, rejected: 0, highConfidence: 0 };
  for (const a of sheet.analyses ?? []) {
    for (const v of a.values ?? []) {
      s.total++;
      if (v.reviewStatus === 'pending') s.pending++;
      else if (v.reviewStatus === 'accepted') s.accepted++;
      else if (v.reviewStatus === 'rejected') s.rejected++;
      if (isHighConfidence(v, policy)) s.highConfidence++;
    }
  }
  return s;
}

function findValue(sheet: ReviewableSheet, caseId: string, fieldId: string): CodedValue | undefined {
  return sheet.analyses?.find((a) => a.id === caseId)?.values?.find((v) => v.fieldId === fieldId);
}

/**
 * 套用一次覆核操作到整批結果（不改動輸入）。
 * 回傳新的 sheets（只複製被改動的表與案件），以及實際改動的欄位（供畫面還原與寫回）。
 * 找不到的欄位會略過，不會建立新的資料。
 */
export function applyReviewOp<T extends ReviewableSheet>(
  sheets: T[],
  op: ReviewOp,
  policy: CodingReviewPolicy = DEFAULT_REVIEW_POLICY,
  at: string = new Date().toISOString(),
): { sheets: T[]; changed: CellRef[] } {
  const out = sheets.map((s) => ({ ...s, analyses: s.analyses?.map((a) => ({ ...a })) })) as T[];
  const changed: CellRef[] = [];

  const patchCell = (ref: CellRef, fn: (v: CodedValue) => CodedValue): void => {
    const sheet = out[ref.sheetIndex];
    if (!sheet) return;
    const a = sheet.analyses?.find((x) => x.id === ref.caseId);
    if (!a?.values) return;
    const i = a.values.findIndex((v) => v.fieldId === ref.fieldId);
    if (i < 0) return;
    a.values = a.values.map((v, j) => (j === i ? fn(v) : v));
    changed.push({ sheetIndex: ref.sheetIndex, caseId: ref.caseId, fieldId: ref.fieldId });
  };

  switch (op.kind) {
    case 'accept':
      if (findValue(out[op.cell.sheetIndex] ?? {}, op.cell.caseId, op.cell.fieldId)) patchCell(op.cell, (v) => reviewValue(v, 'accept', at));
      break;
    case 'reject':
      if (findValue(out[op.cell.sheetIndex] ?? {}, op.cell.caseId, op.cell.fieldId)) patchCell(op.cell, (v) => reviewValue(v, 'reject', at));
      break;
    case 'edit': {
      const text = op.value.trim();
      if (!text) throw new Error('修改後的內容不可為空白');
      if (findValue(out[op.cell.sheetIndex] ?? {}, op.cell.caseId, op.cell.fieldId)) patchCell(op.cell, (v) => reviewValue(v, 'edit', at, text));
      break;
    }
    case 'batch-accept': {
      const sheet = out[op.sheetIndex];
      if (!sheet) break;
      for (const a of sheet.analyses ?? []) {
        for (const v of a.values ?? []) {
          if (isHighConfidence(v, policy)) patchCell({ sheetIndex: op.sheetIndex, caseId: a.id, fieldId: v.fieldId }, (x) => reviewValue(x, 'batch-accept', at));
        }
      }
      break;
    }
    case 'undo':
      for (const ref of op.cells) patchCell(ref, undoReview);
      break;
  }
  return { sheets: out, changed };
}
