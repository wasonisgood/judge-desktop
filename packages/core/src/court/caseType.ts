// 案件類型（民事、刑事、行政）與判決字別的對應。純函式，不做 I/O。
// 判定順序（不猜）：
// 1. 字號中寫明「民事判決／刑事判決／行政訴訟判決」等 → 以它為準（by-suffix）；
// 2. 否則字別只對應到一種類型 → 採用（by-zi）；
// 3. 字別同時屬於多種類型（例如「訴」「上」「聲」「抗」「再」）→ ambiguous，type 為 null，不猜；
// 4. 字別不在任何類型表中（例如「特」）→ unknown，type 為 null，不猜；
// 5. 字號無法解析 → no-caseno。
// 字別表為初版，依司法院判決常見字別整理。遇到表中沒有的字別一律標示 unknown，應補表而非放寬比對。

export const CASE_TYPES = ['民事', '刑事', '行政'] as const;
export type CaseType = (typeof CASE_TYPES)[number];

const ZI_BY_TYPE: Record<CaseType, readonly string[]> = {
  民事: ['訴', '上', '抗', '聲', '再', '重訴', '重上', '小上', '家', '家訴', '家上', '家抗', '家聲', '勞', '勞訴', '勞上', '勞抗', '勞聲', '執', '執事', '執聲', '執全'],
  刑事: ['易', '上易', '交易', '交上易', '訴', '上訴', '聲', '聲再', '抗', '重刑', '重上更', '上更', '簡上'],
  行政: ['訴', '上', '再'],
};

/** 字別 → 可能的類型（由 ZI_BY_TYPE 反推）。 */
const TYPES_BY_ZI = new Map<string, CaseType[]>();
for (const t of CASE_TYPES) {
  for (const zi of ZI_BY_TYPE[t]) {
    const list = TYPES_BY_ZI.get(zi) ?? [];
    list.push(t);
    TYPES_BY_ZI.set(zi, list);
  }
}

/** 字號：「112年度上易字第123號」「113 年 訴 字第 5 號」。 */
const CASE_NO_RE = /(\d{2,3})\s*年\s*(?:度\s*)?([^\d字\n]{1,10}?)\s*字\s*第\s*(\d+)\s*號/;
/** 字號後面的類型用語：「號刑事判決」「號行政訴訟判決」「號民事裁定」。 */
const SUFFIX_RE = /號\s*(民事|刑事|行政訴訟|行政)\s*(判決|裁定)/;

export type CaseTypeStatus = 'by-suffix' | 'by-zi' | 'ambiguous' | 'unknown' | 'no-caseno';

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
      message: `字號明載「${suffix[1]}」，判定為${type}`,
    };
  }
  if (!parsed) {
    return { caseNo: null, zi: null, type: null, status: 'no-caseno', candidates: [], message: '無法解析字號，不判定案件類型' };
  }
  const candidates = TYPES_BY_ZI.get(parsed.zi) ?? [];
  if (candidates.length === 1) {
    return {
      caseNo: parsed.caseNo, zi: parsed.zi, type: candidates[0], status: 'by-zi', candidates,
      message: `字別「${parsed.zi}」只屬於${candidates[0]}`,
    };
  }
  if (candidates.length > 1) {
    return {
      caseNo: parsed.caseNo, zi: parsed.zi, type: null, status: 'ambiguous', candidates,
      message: `字別「${parsed.zi}」同時見於${candidates.join('、')}，字號未寫明類型，不判定`,
    };
  }
  return {
    caseNo: parsed.caseNo, zi: parsed.zi, type: null, status: 'unknown', candidates: [],
    message: `字別「${parsed.zi}」不在民事、刑事、行政的字別表中，不判定`,
  };
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
