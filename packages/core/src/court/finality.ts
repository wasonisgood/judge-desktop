// Step 5 確定判決判斷（純函式，不做 I/O）。
// 輸入：目標判決（本件）、歷審清單（頁面順序，可附已取得的裁判書全文）、被告姓名、今日日期。
// 流程：在歷審中定位本件 → 依各上訴審判決開頭「不服○○法院…判決」找出以本件為原審、且判決內載有該被告姓名的上訴審
//      （同一起訴書其他被告的上訴，因不含該被告姓名而不計入）→ 沿著上訴鏈走到最後一審 → 依裁判日起算的上訴期間判斷。
// 上訴期間：以裁判日期為第 0 天，第 N 天仍在期間內（N ≤ appealDays）；第 appealDays+1 天起視為已確定。預設 120 天。
import { locateInHistory, type HistoryRow } from './history';

export const DEFAULT_APPEAL_DAYS = 120;
const DAY_MS = 86_400_000;

export type FinalityOutcome = 'final' | 'appealed_final' | 'appealed_pending' | 'in_appeal_period' | 'unknown';

export const FINALITY_LABEL: Record<FinalityOutcome, string> = {
  final: '本件確定',
  appealed_final: '本件經上訴，已確定',
  appealed_pending: '本件經上訴，尚未確定',
  in_appeal_period: '尚在上訴期間',
  unknown: '待確認',
};

export interface FinalityHistoryItem {
  row: HistoryRow;
  /** 該審級裁判書的全文；未取得時為 null（繫屬中的列通常沒有）。 */
  fullText?: string | null;
}

export interface FinalityInput {
  target: { title: string; dateIso: string | null; fullText: string };
  /** 被告姓名（用於排除同一起訴書其他被告的上訴）。 */
  defendant: string;
  /** 歷審清單，依頁面順序（parsePrintHistory 的結果，可附全文）。 */
  history: FinalityHistoryItem[];
  /** 今日日期，YYYY-MM-DD（由呼叫端注入，便於測試）。 */
  today: string;
  appealDays?: number;
}

export interface FinalityJudgmentRef {
  court: string;
  caseNo: string;
  dateIso: string | null;
}

export interface FinalityResult {
  outcome: FinalityOutcome;
  label: string;
  /** 「依據」欄的說明文字。 */
  basis: string;
  /** 定應執行刑標示：確定（或經上訴確定）的判決中是否已定應執行刑。 */
  aggregate: { status: 'set' | 'not_set' | 'not_applicable'; note: string };
  /** 最後一審（判斷所依據的判決）；待確認時可能為 null。 */
  finalJudgment: FinalityJudgmentRef | null;
  /** 上訴鏈（不含本件），依審級順序。 */
  appealChain: FinalityJudgmentRef[];
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** 字號的基底（去掉尾端的「判決」「裁定」）。 */
export function caseNoBase(caseNo: string): string {
  return squash(caseNo).replace(/(裁定|判決)$/, '');
}

/** 取出上訴審判決開頭「不服……判決／裁定」的子句；找不到回傳 null。 */
export function appealedFrom(fullText: string): string | null {
  const head = fullText.slice(0, 1200);
  const m = /不服([\s\S]{1,200}?)(?:判決|裁定)/.exec(head);
  return m ? m[1] : null;
}

/** 被告姓名是否出現在判決開頭（上訴人、被告欄位所在處）。 */
export function namedInHeader(fullText: string, name: string): boolean {
  const key = squash(name);
  if (!key) return false;
  return squash(fullText.slice(0, 600)).includes(key);
}

/**
 * 從判決開頭抽出被告姓名（「被告甲○○、乙○○」「上訴人即被告甲○○」等）。
 * 姓名以遇到「犯、因、於、上列」等字或標點為止；去除重複。找不到回傳空陣列。
 */
export function extractDefendants(fullText: string): string[] {
  const head = fullText.slice(0, 600);
  const names: string[] = [];
  const re = /(?:被\s*告|受\s*刑\s*人)\s*([^\s、，,。；;（(:：]{1,40}(?:\s*[、，,]\s*[^\s、，,。；;（(:：]{1,40})*)/g;
  for (const m of head.matchAll(re)) {
    for (const part of m[1].split(/[、，,]/)) {
      const name = cleanDefendantName(part.trim());
      if (name.length < 2 || name.length > 8 || /[\d份各]/.test(name)) continue;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** 名稱之後常接的詞（指定辯護人、上列、前案紀錄…）：遇到即截斷。 */
const NAME_CUT = ['指定', '選任', '辯護人', '上列', '前案', '在卷', '紀錄', '現', '繫屬', '入監', '執行', '在押', '羈押', '因', '犯', '於', '經', '即', '與', '及', '年', '月', '日', '等', '本院', '公訴'];

function cleanDefendantName(raw: string): string {
  let s = raw;
  for (const k of NAME_CUT) {
    const i = s.indexOf(k);
    if (i >= 0) s = s.slice(0, i);
  }
  return s.trim();
}

/** 上訴審判決是否以 ref 為原審，且載明被告姓名。 */
function isAppealOf(childText: string, ref: FinalityJudgmentRef, defendant: string): boolean {
  if (!namedInHeader(childText, defendant)) return false;
  const clause = appealedFrom(childText);
  if (!clause) return false;
  const c = squash(clause);
  const base = caseNoBase(ref.caseNo);
  return c.includes(squash(ref.court)) && c.includes(base);
}

/** 兩個 YYYY-MM-DD 之間的天數（b 減 a）。 */
export function daysBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(bIso) - Date.parse(aIso)) / DAY_MS);
}

function refOf(row: HistoryRow): FinalityJudgmentRef {
  return { court: row.court, caseNo: row.caseNo, dateIso: row.dateIso };
}

function result(outcome: FinalityOutcome, basis: string, extra: Partial<Pick<FinalityResult, 'finalJudgment' | 'appealChain' | 'aggregate'>> = {}): FinalityResult {
  return {
    outcome,
    label: FINALITY_LABEL[outcome],
    basis,
    aggregate: extra.aggregate ?? { status: 'not_applicable', note: '' },
    finalJudgment: extra.finalJudgment ?? null,
    appealChain: extra.appealChain ?? [],
  };
}

const AGGREGATE_RE = /定應執行刑/;

function aggregateFor(outcome: FinalityOutcome, text: string): FinalityResult['aggregate'] {
  if (outcome !== 'final' && outcome !== 'appealed_final') return { status: 'not_applicable', note: '' };
  if (AGGREGATE_RE.test(text)) return { status: 'set', note: '判決已定應執行刑。' };
  return { status: 'not_set', note: '判決未定應執行刑，請另查「聲」字裁定是否就本案定應執行刑。' };
}

/** 判斷本件是否確定（五種結果之一，無法判定時為「待確認」並說明原因）。 */
export function judgeFinality(input: FinalityInput): FinalityResult {
  const appealDays = input.appealDays ?? DEFAULT_APPEAL_DAYS;
  if (!Number.isInteger(appealDays) || appealDays <= 0) throw new RangeError('上訴期間須為正整數天數');
  const { target, defendant, history, today } = input;
  if (!squash(defendant)) return result('unknown', '未提供被告姓名，無法排除其他被告的上訴。');
  if (!target.dateIso) return result('unknown', '本件判決缺少裁判日期，無法計算上訴期間。');
  if (!squash(target.fullText)) return result('unknown', '本件判決全文未取得，無法確認被告姓名。');
  if (!namedInHeader(target.fullText, defendant)) return result('unknown', `被告姓名「${defendant}」未出現在本件判決開頭，請人工確認。`);

  const rows = history.map((h) => h.row);
  let startIdx: number;
  let chain: number[] = [];
  let terminalText = target.fullText;
  let terminal: FinalityJudgmentRef;

  if (rows.length === 0) {
    // 沒有歷審資料：本件即唯一審級。
    startIdx = -1;
    terminal = { court: '', caseNo: '', dateIso: target.dateIso };
  } else {
    const pos = locateInHistory(rows, { title: target.title, dateIso: target.dateIso });
    if (pos.status !== 'located' || pos.index === null) return result('unknown', `無法在歷審中定位本件：${pos.summary}`);
    startIdx = pos.index;
    terminal = refOf(rows[startIdx]);
  }

  // 沿上訴鏈往後走：每一層找出以目前這一審為原審、且載明被告的上訴審判決，取最後一筆續行。
  let cur = startIdx;
  let curRef: FinalityJudgmentRef = terminal;
  for (;;) {
    let next = -1;
    for (let j = cur + 1; j < history.length; j++) {
      const item = history[j];
      if (item.row.pending) continue;
      if (item.fullText == null) {
        return result('unknown', `歷審第 ${j + 1} 筆（${item.row.court} ${item.row.caseNo}）未取得裁判書，無法判斷是否為本件或同案其他被告的上訴。`);
      }
      if (isAppealOf(item.fullText, curRef, defendant)) next = j;
    }
    if (next < 0) break;
    chain.push(next);
    cur = next;
    curRef = refOf(history[next].row);
    terminalText = history[next].fullText ?? terminalText;
  }

  const terminalRow = cur >= 0 ? rows[cur] : null;
  const appealChain = chain.map((j) => refOf(rows[j]));
  if (terminalRow) terminal = refOf(terminalRow);

  // 繫屬中（尚無裁判書）或上訴最高法院審理中的列，位於最後一審之後：尚未確定。
  const laterPending = rows.some((r, j) => j > cur && r.pending);
  const supremeAfterStart = rows.some((r, j) => j > startIdx && r.supremeAppeal);
  const appealed = chain.length > 0;
  if (laterPending || supremeAfterStart) {
    const why = supremeAfterStart ? '歷審中有案件上訴至最高法院審理中' : '歷審中有繫屬中（尚無裁判書）的後續審級';
    return result('appealed_pending', `${why}。`, { finalJudgment: terminal, appealChain, aggregate: { status: 'not_applicable', note: '' } });
  }

  if (!terminal.dateIso) return result('unknown', '最後一審缺少裁判日期，無法計算上訴期間。', { finalJudgment: terminal, appealChain });
  const elapsed = daysBetween(terminal.dateIso, today);
  if (elapsed < 0) return result('unknown', `最後一審裁判日期（${terminal.dateIso}）晚於今日，請確認日期。`, { finalJudgment: terminal, appealChain });

  if (elapsed <= appealDays) {
    const outcome: FinalityOutcome = appealed ? 'appealed_pending' : 'in_appeal_period';
    const basis = appealed
      ? `最後一審裁判日期 ${terminal.dateIso}，距今 ${elapsed} 天，仍在 ${appealDays} 天上訴期間內。`
      : `裁判日期 ${terminal.dateIso}，距今 ${elapsed} 天，仍在 ${appealDays} 天上訴期間內。`;
    return result(outcome, basis, { finalJudgment: terminal, appealChain });
  }

  const outcome: FinalityOutcome = appealed ? 'appealed_final' : 'final';
  const basis = appealed
    ? `最後一審（${terminal.court} ${terminal.caseNo}）裁判日期 ${terminal.dateIso}，已逾 ${appealDays} 天上訴期間，且無後續上訴。`
    : `裁判日期 ${terminal.dateIso}，已逾 ${appealDays} 天上訴期間，且歷審中無後續上訴。`;
  return result(outcome, basis, {
    finalJudgment: terminal,
    appealChain,
    aggregate: aggregateFor(outcome, terminalText),
  });
}
