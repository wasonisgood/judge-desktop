// 標編碼標注工序：分析欄位（預設集＋自訂欄位）與逐案編碼結果的資料結構，以及依據驗證的純函式。
// 規則：每個欄位的內容由 AI 產生，但依據（引文）必須逐字出現在判決原文中，驗證不過的依據一律丟掉；
// 內容無效或依據不全的欄位標示為「待覆核」，交給使用者確認（覆核畫面由其他模組處理，這裡只保留欄位）。
// 所有結構都可序列化（純 JSON），可直接存入檔案管理。
import { keepVerifiedQuotes, locateQuote } from '../ai/evidence';
import { DEFAULT_REVIEW_POLICY, decideReview, type CodingReviewPolicy, type ReviewStep } from './coding-review';

/** 分析欄位設定。順序即畫面與匯出的欄位順序。 */
export interface CodingField {
  /** 穩定識別碼：預設欄位使用固定值，自訂欄位由 normalizeCodingFields 指派。 */
  id: string;
  /** 欄位名稱，例如「爭點」「原告請求的金額」。 */
  name: string;
  /** 說明（選填）：AI 會依此整理這個欄位。 */
  description?: string;
}

/** 畫面送來的欄位設定：enabled 表示是否勾選（未提供時視為勾選）。 */
export interface CodingFieldInput {
  id?: string;
  name: string;
  description?: string;
  enabled?: boolean;
}

/**
 * 預設欄位集（與原本的逐案分析欄位一致，順序也相同，舊的 Excel 版面不變；id 沿用舊欄位名，舊結果可直接對應）。
 * 使用者可取消勾選、改名、調整順序，或加入自訂欄位。
 */
export const DEFAULT_CODING_FIELDS: CodingField[] = [
  { id: 'group', name: '分類', description: '依案件性質歸類的類型名稱（四字到十字）' },
  { id: 'issue', name: '爭點', description: '本案爭點' },
  { id: 'holding', name: '法院見解', description: '法院見解（核心論證）' },
  { id: 'statuteApplication', name: '法條適用', description: '該法規如何被適用或排除' },
  { id: 'outcome', name: '結論', description: '結論（駁回、廢棄發回、准許等）' },
];

/** 欄位名稱的上限（字），避免過長的自訂名稱撐爆表格與提示詞。 */
const MAX_NAME = 30;
const MAX_DESC = 120;

/**
 * 清理欄位設定：去除未勾選、空白名稱與重複名稱；保留順序；識別碼不重複（重複或缺漏的識別碼重新指派）。
 * 回傳的都是勾選中的欄位；需要保留未勾選欄位時請直接保存輸入值。
 */
export function normalizeCodingFields(input: CodingFieldInput[]): CodingField[] {
  const names = new Set<string>();
  const ids = new Set<string>();
  const out: CodingField[] = [];
  for (const f of input) {
    if (!f || f.enabled === false) continue;
    const name = String(f.name ?? '').trim().slice(0, MAX_NAME);
    if (!name || names.has(name)) continue;
    names.add(name);
    let id = String(f.id ?? '').trim();
    if (!id || ids.has(id)) {
      let n = out.length + 1;
      while (ids.has(`custom-${n}`)) n++;
      id = `custom-${n}`;
    }
    ids.add(id);
    const description = String(f.description ?? '').trim().slice(0, MAX_DESC) || undefined;
    out.push({ id, name, description });
  }
  return out;
}

/** 單一欄位的編碼結果（可序列化）。 */
export type ReviewStatus = 'none' | 'pending' | 'accepted' | 'rejected';
export interface CodedValue {
  fieldId: string;
  fieldName: string;
  /** AI 整理的內容（空字串表示未取得）。 */
  value: string;
  /** 已驗證、逐字存在於判決原文中的依據。 */
  evidence: string[];
  /** 被丟棄的依據數量（不在原文中找到）。 */
  droppedEvidence: number;
  /** 覆核狀態：none＝無須覆核；pending＝待覆核（內容或依據有問題）；accepted／rejected 由覆核流程寫入。 */
  reviewStatus: ReviewStatus;
  /** 待覆核的原因（給使用者看）。 */
  reviewNote?: string;
  /** AI 原始內容：人工修改過才會有值（修改前的內容，供對照與還原）。 */
  aiValue?: string;
  /** 覆核操作紀錄（每次都保存操作前的內容與狀態，可逐步還原）。 */
  reviewHistory?: ReviewStep[];
}

/** 依據驗證：只保留逐字存在於判決原文中的引文（忽略空白與全形差異）。 */
function checkEvidence(fullText: string, raw: unknown): { evidence: string[]; dropped: number } {
  const list = Array.isArray(raw) ? raw.filter((q): q is string => typeof q === 'string' && q.trim().length > 0) : [];
  const evidence = keepVerifiedQuotes(fullText, list);
  const dropped = list.filter((q) => !locateQuote(fullText, q)).length;
  return { evidence, dropped };
}

/**
 * 驗證單一欄位的 AI 回覆：依據逐字驗證後，套用覆核規則（見 coding-review.ts）決定是否待覆核。
 * 門檻預設值見 DEFAULT_REVIEW_POLICY；可由設定傳入。
 */
export function verifyCodedValue(fullText: string, field: CodingField, raw: { value?: unknown; evidence?: unknown }, policy: CodingReviewPolicy = DEFAULT_REVIEW_POLICY): CodedValue {
  const value = typeof raw?.value === 'string' ? raw.value.trim() : '';
  const { evidence, dropped } = checkEvidence(fullText, raw?.evidence);
  const decision = decideReview({ value, evidence, dropped }, policy);
  return { fieldId: field.id, fieldName: field.name, value, evidence, droppedEvidence: dropped, reviewStatus: decision.reviewStatus, reviewNote: decision.reviewNote };
}

/**
 * 依欄位設定驗證整批 AI 回覆（格式：{"values":[{"id","value","evidence"}]}）。
 * 每個欄位都會產生一筆結果：AI 漏掉的欄位視為未取得內容（待覆核），不猜。
 */
export function verifyCodedValues(fullText: string, fields: CodingField[], reply: unknown, policy: CodingReviewPolicy = DEFAULT_REVIEW_POLICY): CodedValue[] {
  const list = reply && typeof reply === 'object' && Array.isArray((reply as { values?: unknown }).values)
    ? (reply as { values: unknown[] }).values
    : [];
  const byId = new Map<string, { value?: unknown; evidence?: unknown }>();
  for (const item of list) {
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      byId.set((item as { id: string }).id, item as { value?: unknown; evidence?: unknown });
    }
  }
  return fields.map((f) => verifyCodedValue(fullText, f, byId.get(f.id) ?? {}, policy));
}

/** 待覆核的格數（用於狀態列與匯出說明）。 */
export function countPendingReview(items: { values?: CodedValue[] }[]): number {
  let n = 0;
  for (const it of items) for (const v of it.values ?? []) if (v.reviewStatus === 'pending') n++;
  return n;
}

/**
 * 匯出用的儲存格文字：內容、AI 原文（人工修改過時）、逐字依據與覆核狀態放在同一格，依據不會與內容分離。
 */
export function formatCodedCell(v: CodedValue | undefined): string {
  if (!v) return '';
  const parts = [v.value || '（未取得）'];
  if (v.aiValue !== undefined && v.aiValue !== v.value) parts.push(`AI 原文：${v.aiValue || '（未取得）'}`);
  if (v.evidence.length) parts.push(`依據：${v.evidence.join('；')}`);
  const tag = reviewTag(v);
  if (tag) parts.push(tag);
  return parts.join('\n');
}

/** 覆核狀態的文字標記（無須覆核的結果不加標記）。 */
export function reviewTag(v: CodedValue): string {
  if (v.reviewStatus === 'pending') return `【待覆核】${v.reviewNote ?? ''}`.trim();
  if (v.reviewStatus === 'rejected') return '【已駁回】';
  if (v.reviewStatus === 'accepted') return v.aiValue !== undefined && v.aiValue !== v.value ? '【已修改】' : '【已接受】';
  return '';
}
