// 案件類型參數的純函式（不做 I/O，不依賴 electron，可直接測試）：
// 範圍整理（篩選）與單一判決精讀（提示＋字號檢查）共用。
import { caseTypeOf, matchCaseType, parseCaseTypeInput, type CaseType, type CaseTypeStatus } from '@judge/core';

export interface CaseTypeArg {
  /** 解析後的案件類型；未指定或無法辨識時為 undefined（不套用）。 */
  caseType: CaseType | undefined;
  /** 需要告知使用者的說明（例如輸入無法辨識）；沒有則為 null。 */
  note: string | null;
}

/** 解析介面或研究設計帶入的案件類型。空值表示不限；無法辨識時不套用，並說明。 */
export function resolveCaseTypeArg(raw: unknown): CaseTypeArg {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { caseType: undefined, note: null };
  const t = parseCaseTypeInput(s);
  if (!t) return { caseType: undefined, note: `案件類型「${s}」無法對應民事、刑事或行政，未套用篩選。` };
  return { caseType: t, note: null };
}

/** 字號判定為明確類型（by-suffix／by-zi）而與指定不符，才算「確定不符」；其餘為無法判定。 */
function isDeterminate(status: CaseTypeStatus): boolean {
  return status === 'by-suffix' || status === 'by-zi';
}

/**
 * 範圍整理因案件類型被排除的判決，寫成一則說明。沒有排除時回傳 null。
 * skipped 的 status 來自 core 的 onCaseTypeSkip。
 */
export function caseTypeSkipNote(statute: string, caseType: CaseType, skipped: { status: CaseTypeStatus }[]): string | null {
  if (!skipped.length) return null;
  const mismatch = skipped.filter((x) => isDeterminate(x.status)).length;
  const undecided = skipped.length - mismatch;
  const parts = [`「${statute}」依案件類型「${caseType}」篩選：排除 ${mismatch} 筆字號明載其他類型的判決`];
  if (undecided) parts.push(`另 ${undecided} 筆字別同時見於多種類型或不在字別表中，字號未寫明類型，依「不猜」原則排除（可於判決列表中人工確認）`);
  return parts.join('；') + '。';
}

export interface BriefCaseTypeCheck {
  /** match：字號判定與指定相符；mismatch：字號明載其他類型；unknown：字號無法判定；none：未指定。 */
  status: 'none' | 'match' | 'mismatch' | 'unknown';
  /** 字號判定出的類型（無法判定時為 null）。 */
  judged: CaseType | null;
  /** 給使用者看的說明；未指定時為 null。 */
  note: string | null;
  /** 交給 AI 的重點提示（未指定時為空字串）。案件類型是提示，不取代判決原文的判讀。 */
  focusHint: string;
}

/**
 * 精讀的案件類型：精讀只有一則判決，沒有「篩選」可做，因此：
 * 1. 把指定的類型放進交給 AI 的重點（作為提示詞）；
 * 2. 依判決字號檢查是否相符，不符或無法判定時只提醒、不阻擋（判決由使用者指定）。
 */
export function briefCaseTypeCheck(judgmentTitle: string, chosen: CaseType | undefined): BriefCaseTypeCheck {
  if (!chosen) return { status: 'none', judged: null, note: null, focusHint: '' };
  const focusHint = `案件類型：${chosen}（研究提示，請依判決原文判讀）`;
  const m = matchCaseType(judgmentTitle, chosen);
  const info = caseTypeOf(judgmentTitle);
  if (m === 'match') {
    return { status: 'match', judged: info.type, note: `判決字號判定為${chosen}，與指定的案件類型相符。`, focusHint };
  }
  if (m === 'mismatch') {
    return {
      status: 'mismatch', judged: info.type,
      note: `注意：判決字號判定為${info.type}，與指定的${chosen}不符；仍依指定的案件類型提示 AI，請確認是否選錯判決。`,
      focusHint,
    };
  }
  return {
    status: 'unknown', judged: null,
    note: `判決字號無法判定案件類型（${info.message}），無法確認是否符合指定的${chosen}；仍依指定的案件類型提示 AI。`,
    focusHint,
  };
}
