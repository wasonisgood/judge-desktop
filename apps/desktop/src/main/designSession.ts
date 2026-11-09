// 研究設計引導（issue #11）的桌面端純函式：狀態轉換、畫面資料、AI 欄位整理的輸入檢核。
// 不依賴 Electron，可直接測試。所有建議都只是選項：suggestion 只有研究者接受後才寫入欄位。
import {
  type AiComplete, type DesignSession, type DesignSlots, type NarrowingSuggestion, type FeasibilityCheck,
  type DesignSummary, type GuideStep, SLOT_LABEL,
  addGuideTurn, acceptSuggestion, answerSlot, buildDesignSummary, designSummaryText, feasibilityChecks,
  nextStep, newSession, parseJsonReply, suggestNarrowing, summaryToScopeOptions,
} from '@judge/core';

/** 可手動編輯與 AI 可回填的欄位（DesignSlots 的已知鍵，不含 problem）。 */
export const FIELD_KEYS = ['question', 'subject', 'variable', 'yearFrom', 'yearTo', 'statute', 'caseType', 'courtLevel'] as const;
export type FieldKey = typeof FIELD_KEYS[number];
export type FieldValue = string | number;
export type FieldPatch = Partial<Record<FieldKey, FieldValue>>;

const FIELD_LABEL: Record<FieldKey, string> = {
  ...SLOT_LABEL,
  yearFrom: '期間（起始年）',
  yearTo: '期間（結束年）',
};

export interface StoredDesign {
  session: DesignSession;
  /** 研究者略過的建議（只影響畫面，不改動條件）。 */
  skipped: string[];
}

export interface DesignView {
  id: string;
  session: DesignSession;
  step: GuideStep | null;
  checks: FeasibilityCheck[];
  suggestions: NarrowingSuggestion[];
  summary: DesignSummary;
  summaryText: string;
  /** 帶入範圍整理的參數；沒有法規時為 null。 */
  scopeOptions: ReturnType<typeof summaryToScopeOptions>;
  /** 欄位表單用的字串值（年份為字串，缺值為空字串）。 */
  fields: Record<FieldKey, string>;
}

export interface DesignListItem {
  id: string;
  title: string;
  updatedAt: string;
  turns: number;
}

/** 開始一段研究設計：記下問題意識，並提出第一個追問（附理由）。 */
export function startSession(problem: string, now: Date = new Date()): DesignSession {
  const text = problem.trim();
  if (!text) throw new Error('請先輸入問題意識（可以很模糊）');
  let session = newSession(text, now);
  const step = nextStep(session.slots);
  if (step) session = addGuideTurn(session, step.prompt, step.rationale, now);
  return session;
}

/** 回答目前的追問（追問的欄位由 nextStep 決定），並提出下一個追問。 */
export function answerCurrent(session: DesignSession, text: string, now: Date = new Date()): DesignSession {
  const step = nextStep(session.slots);
  if (!step) throw new Error('所有追問都已回答，可以檢視建議與摘要');
  if (!text.trim()) throw new Error('請輸入回答');
  let next = answerSlot(session, step.slot, text, now);
  const following = nextStep(next.slots);
  if (following) next = addGuideTurn(next, following.prompt, following.rationale, now);
  return next;
}

/** 手動編輯欄位（表單的值）。空字串表示清除；年份必須是西元四位數。沒有實際變動時回傳原物件。 */
export function applyFieldEdits(session: DesignSession, input: Record<string, unknown>, now: Date = new Date()): DesignSession {
  const slots: Record<string, unknown> = { ...session.slots };
  const changed: string[] = [];
  for (const key of FIELD_KEYS) {
    if (!(key in input)) continue;
    const raw = input[key] === undefined || input[key] === null ? '' : String(input[key]).trim();
    let next: string | number | undefined;
    if (key === 'yearFrom' || key === 'yearTo') {
      if (!raw) {
        next = undefined;
      } else {
        const y = Number(raw);
        if (!/^\d{4}$/.test(raw) || y < 1900 || y > 2200) throw new Error(`${FIELD_LABEL[key]}請輸入西元年，例如 2018`);
        next = y;
      }
    } else {
      next = raw || undefined;
    }
    if (slots[key] !== next) {
      slots[key] = next;
      changed.push(FIELD_LABEL[key]);
    }
  }
  if (changed.length === 0) return session;
  const stamp = now.toISOString();
  return {
    ...session,
    slots: slots as unknown as DesignSlots,
    updatedAt: stamp,
    turns: [...session.turns, { role: 'user', text: `手動更新欄位：${changed.join('、')}`, at: stamp }],
  };
}

/** 接受一則範圍縮小建議（只有這裡會寫入 patch）。 */
export function acceptById(session: DesignSession, suggestionId: string, now: Date = new Date()): DesignSession {
  const s = suggestNarrowing(session.slots).find((x) => x.id === suggestionId);
  if (!s) throw new Error('這則建議已不適用，請重新整理畫面');
  return acceptSuggestion(session, s, now);
}

/** 清理 AI 回傳的欄位：只保留 DesignSlots 的已知鍵；字串需非空，年份需為 1900–2200 的整數。 */
export function sanitizeFieldPatch(raw: unknown): FieldPatch {
  const out: FieldPatch = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const key of FIELD_KEYS) {
    const v = src[key];
    if (key === 'yearFrom' || key === 'yearTo') {
      const y = typeof v === 'number' ? v : typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
      if (Number.isInteger(y) && y >= 1900 && y <= 2200) out[key] = y;
    } else if (typeof v === 'string' && v.trim()) {
      out[key] = v.trim();
    }
  }
  return out;
}

const AI_FILL_SYSTEM = [
  '你是研究設計的整理助理。使用者會用自然語言描述想研究的問題。',
  '請只整理使用者明確提到的內容，輸出一個 JSON 物件。JSON 的鍵只能是：',
  'question（可實證的研究問題，一句話）、subject（研究對象）、variable（要比較或觀察的變項）、',
  'yearFrom、yearTo（西元整數年）、statute（法規名稱或條號）、caseType（民事、刑事或行政）、',
  'courtLevel（地方法院、高等法院或最高法院）。',
  '沒有提到的鍵不要輸出，不得編造使用者沒有提到的內容。只輸出 JSON，不要其他說明。',
].join('');

/** AI 把自然語言整理成欄位草稿（不寫入；由研究者在表單確認後才儲存）。 */
export async function aiFillFields(ai: AiComplete, text: string): Promise<FieldPatch> {
  const user = text.trim();
  if (!user) throw new Error('請先在回答框輸入想法，再按「AI 整理」');
  const raw = await ai(AI_FILL_SYSTEM, user, 800);
  return sanitizeFieldPatch(parseJsonReply<unknown>(raw));
}

function fieldStrings(slots: DesignSlots): Record<FieldKey, string> {
  const out = {} as Record<FieldKey, string>;
  for (const key of FIELD_KEYS) {
    const v = (slots as unknown as Record<string, unknown>)[key];
    out[key] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

/** 組出畫面需要的全部資料。純函式：不改動 session，也不寫入任何欄位。 */
export function buildView(entry: StoredDesign, id: string, now: Date = new Date()): DesignView {
  const { session, skipped } = entry;
  const accepted = new Set(session.accepted.map((a) => a.id));
  const hidden = new Set([...accepted, ...skipped]);
  const summary = buildDesignSummary(session);
  return {
    id,
    session,
    step: nextStep(session.slots),
    checks: feasibilityChecks(session.slots, now),
    suggestions: suggestNarrowing(session.slots).filter((s) => !hidden.has(s.id)),
    summary,
    summaryText: designSummaryText(summary),
    scopeOptions: summaryToScopeOptions(session.slots),
    fields: fieldStrings(session.slots),
  };
}

/** 清單用的摘要（不含完整對話）。 */
export function listItemOf(entry: StoredDesign): DesignListItem {
  const s = entry.session;
  return {
    id: s.id,
    title: (s.slots.question || s.slots.problem || '未命名').slice(0, 60),
    updatedAt: s.updatedAt,
    turns: s.turns.length,
  };
}
