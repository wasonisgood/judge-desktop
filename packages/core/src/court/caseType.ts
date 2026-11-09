// 案件類型（民事、刑事、行政）與判決字號的對應。純函式，不做 I/O。
// 判定順序（不猜）：
// 1. 字號中寫明「民事判決／刑事裁定／行政訴訟判決」等 → 以它為準（by-suffix）；
// 2. 法院名稱含「行政法院」→ 行政（by-court；行政法院只審理行政訴訟，判決多不寫類型字樣）；
// 3. 字別在 ZI_EXACT（實際字號只見於單一類型）→ 採用（by-zi）；
// 4. 字別在 ZI_AMBIGUOUS（實際字號見於多種類型，例如「訴」「上」「聲」「抗」「再」）→ ambiguous，type 為 null，不猜；
// 5. 字別以 ZI_PREFIX 的前綴開頭（例如「司」「消」「原」「國審」），且該前綴的觀察全部同類型 → 採用（by-zi）；
// 6. 其餘 → unknown，type 為 null，不猜；字號無法解析 → no-caseno。
// 字別表資料與證據數量見 caseTypeTable.ts（由搜尋結果產生）。

import { ZI_AMBIGUOUS, ZI_EXACT, ZI_PREFIX } from './caseTypeTable';

export const CASE_TYPES = ['民事', '刑事', '行政'] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** 字號：「112年度上易字第123號」「115 年度 訴 字第 238 號」。 */
const CASE_NO_RE = /(\d{2,3})\s*年\s*(?:度\s*)?([^\d字\n]{1,10}?)\s*字\s*第\s*(\d+)\s*號/;
/** 字號後面的類型用語：「號民事裁定」「號刑事判決」「號行政訴訟判決」。 */
const SUFFIX_RE = /號\s*(民事|刑事|行政訴訟|行政)\s*(判決|裁定)/;
/** 法院名稱：字號之前的部分。 */
const COURT_RE = /^(.*?)\s*\d{2,3}\s*年/;

export type CaseTypeStatus = 'by-suffix' | 'by-court' | 'by-zi' | 'ambiguous' | 'unknown' | 'no-caseno';

export interface CaseTypeInfo {
  /** 標準化後的字號（例如「112年度上易字第123號」）；無法解析時為 null。 */
  caseNo: string | null;
  /** 字別（例如「上易」）；無法解析時為 null。 */
  zi: string | null;
  /** 判定的案件類型；ambiguous、unknown、no-caseno 時為 null。 */
  type: CaseType | null;
  status: CaseTypeStatus;
  /** 字別可能對應的類型（ambiguous 時列出所有候選）。 */
  candidates: CaseType[];
  /** 判定依據的證據筆數（字號或字別表）；沒有字別依據時為 null。 */
  evidence: number | null;
  /** 給研究者看的說明。 */
  message: string;
}

/** 解析字號與字別（不判定類型）。 */
export function parseCaseNo(text: string | null | undefined): { caseNo: string; zi: string; year: number; no: number } | null {
  const m = CASE_NO_RE.exec(String(text ?? ''));
  if (!m) return null;
  const zi = m[2].replace(/\s+/g, '');
  return { caseNo: `${Number(m[1])}年度${zi}字第${Number(m[3])}號`, zi, year: Number(m[1]), no: Number(m[3]) };
}

type ZiVerdict = Pick<CaseTypeInfo, 'type' | 'status' | 'candidates' | 'evidence' | 'message'>;

/** 只依字別判定（不含字號類型用語與法院）。 */
export function lookupZi(zi: string): ZiVerdict {
  const exact = Object.prototype.hasOwnProperty.call(ZI_EXACT, zi) ? ZI_EXACT[zi] : undefined;
  if (exact && exact.type === '行政') {
    // 行政字別的觀察全部來自行政法院（判決多不寫類型字樣）；非行政法院的同字別不以字別單獨判定。
    return {
      type: null, status: 'unknown', candidates: [], evidence: exact.evidence,
      message: `字別「${zi}」只在行政法院的字號中觀察到（${exact.evidence} 筆），法院非行政法院時不判定`,
    };
  }
  if (exact) {
    const note = exact.observed === false ? '；實際字號未觀察到，依使用者指定' : '';
    return {
      type: exact.type, status: 'by-zi', candidates: [exact.type], evidence: exact.evidence,
      message: `字別「${zi}」在搜尋結果中只見於${exact.type}（${exact.evidence} 筆）${note}`,
    };
  }
  const amb = Object.prototype.hasOwnProperty.call(ZI_AMBIGUOUS, zi) ? ZI_AMBIGUOUS[zi] : undefined;
  if (amb) {
    return {
      type: null, status: 'ambiguous', candidates: [...amb.types], evidence: amb.evidence,
      message: `字別「${zi}」同時見於${amb.types.join('、')}（${amb.evidence} 筆），字號未寫明類型，不判定`,
    };
  }
  const pre = ZI_PREFIX.filter((p) => zi.startsWith(p.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (pre) {
    return {
      type: pre.type, status: 'by-zi', candidates: [pre.type], evidence: pre.evidence,
      message: `字別「${zi}」以「${pre.prefix}」開頭，該前綴的觀察皆為${pre.type}（前綴 ${pre.zi} 種字別、${pre.evidence} 筆）`,
    };
  }
  return { type: null, status: 'unknown', candidates: [], evidence: null, message: `字別「${zi}」不在字別表中（實際字號未觀察到），不判定` };
}

/** 依字號（或裁判字號全文）判定案件類型。 */
export function caseTypeOf(text: string | null | undefined): CaseTypeInfo {
  const s = String(text ?? '');
  const parsed = parseCaseNo(s);
  const suffix = SUFFIX_RE.exec(s);
  if (suffix) {
    const type: CaseType = suffix[1] === '行政訴訟' ? '行政' : (suffix[1] as CaseType);
    return {
      caseNo: parsed?.caseNo ?? null,
      zi: parsed?.zi ?? null,
      type,
      status: 'by-suffix',
      candidates: [type],
      evidence: null,
      message: `字號明載「${suffix[1]}」，判定為${type}`,
    };
  }
  if (!parsed) {
    return { caseNo: null, zi: null, type: null, status: 'no-caseno', candidates: [], evidence: null, message: '無法解析字號，不判定案件類型' };
  }
  const court = COURT_RE.exec(s)?.[1] ?? '';
  if (court.includes('行政法院')) {
    return {
      caseNo: parsed.caseNo, zi: parsed.zi, type: '行政', status: 'by-court', candidates: ['行政'], evidence: null,
      message: `法院為「${court}」（行政法院只審理行政訴訟），判定為行政`,
    };
  }
  return { caseNo: parsed.caseNo, zi: parsed.zi, ...lookupZi(parsed.zi) };
}

/** 結果表上顯示的類型標籤：民事／刑事／行政，或「重疊」（字別同時見於多類）、「未知」（不在字別表中或無法解析）。 */
export function caseTypeLabel(text: string | null | undefined): CaseType | '重疊' | '未知' {
  const info = caseTypeOf(text);
  if (info.type) return info.type;
  return info.status === 'ambiguous' ? '重疊' : '未知';
}

/**
 * 字號是否符合指定的案件類型。
 * 'unknown' 表示無法判定（不是不符合）；篩選時應排除並說明，不應當作符合。
 */
export function matchCaseType(text: string | null | undefined, want: CaseType): 'match' | 'mismatch' | 'unknown' {
  const info = caseTypeOf(text);
  if (info.type === null) return 'unknown';
  return info.type === want ? 'match' : 'mismatch';
}

/**
 * 把使用者輸入（例如「民事」「民事案件」「刑事（簡易）」）解析為案件類型。
 * 只接受唯一一個類型用語；同時出現多個或沒有時回傳 null（不猜）。
 */
export function parseCaseTypeInput(input: string | null | undefined): CaseType | null {
  const s = String(input ?? '');
  const hits = CASE_TYPES.filter((t) => s.includes(t));
  return hits.length === 1 ? hits[0] : null;
}
