// 量化圖表（issue #8）的資料層：欄位型態判斷、數值解析、分組計數（裁判書數或列數）、交叉表、金額級距。純函式。

export type Cell = string | number | boolean | null | undefined;
export type ChartRow = Record<string, Cell>;
export type ColumnKind = 'number' | 'date' | 'category' | 'empty';
/** 計數單位：裁判書數（依 ID 去重）或列數（依原始列）。圖表標題必須註明所用單位。 */
export type CountUnit = 'judgments' | 'rows';

export const BLANK_LABEL = '（空白）';

export function isBlank(v: Cell): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** 把儲存格轉為有限數值；無法解析（含非數字文字）回傳 null。去除千分位逗號與全形空白。 */
export function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[,，\s　]/g, '').replace(/^NT\$/i, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const DATE_PATTERNS = [/^\d{4}-\d{2}-\d{2}$/, /^\d{4}\/\d{1,2}\/\d{1,2}$/, /^\d{2,3}\/\d{1,2}\/\d{1,2}$/];

/** 判斷欄位型態：全部空白為 empty；全部為數值為 number；全部為日期格式為 date；其餘為 category。 */
export function inferColumnKind(values: Cell[]): ColumnKind {
  const present = values.filter((v) => !isBlank(v));
  if (!present.length) return 'empty';
  if (present.every((v) => toNumber(v) !== null)) return 'number';
  const isDate = (v: Cell) => typeof v === 'string' && DATE_PATTERNS.some((p) => p.test(v.trim()));
  if (present.every(isDate)) return 'date';
  return 'category';
}

export function columnKinds(rows: ChartRow[], headers: string[]): Record<string, ColumnKind> {
  const out: Record<string, ColumnKind> = {};
  for (const h of headers) out[h] = inferColumnKind(rows.map((r) => r[h]));
  return out;
}

export interface GroupCount {
  key: string;
  count: number;
}

export interface CountOptions {
  unit: CountUnit;
  /** 裁判書 ID 欄（unit 為 judgments 時必填）。 */
  idColumn?: string;
}

function countUnits(rows: ChartRow[], opts: CountOptions): number {
  if (opts.unit === 'rows') return rows.length;
  if (!opts.idColumn) throw new Error('以裁判書數計算時必須指定 ID 欄位');
  const ids = new Set<string>();
  for (const r of rows) {
    const id = r[opts.idColumn];
    if (!isBlank(id)) ids.add(String(id).trim());
  }
  return ids.size;
}

/** 依一欄分組計數。空白歸入「（空白）」。依件數由多到少排序（同數時依名稱）。 */
export function groupCount(rows: ChartRow[], column: string, opts: CountOptions): GroupCount[] {
  const buckets = new Map<string, ChartRow[]>();
  for (const r of rows) {
    const key = isBlank(r[column]) ? BLANK_LABEL : String(r[column]).trim();
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  return [...buckets.entries()]
    .map(([key, list]) => ({ key, count: countUnits(list, opts) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-Hant'));
}

export interface Crosstab {
  rowLabels: string[];
  colLabels: string[];
  /** cells[i][j] 為第 i 列、第 j 行的計數（依所選單位）。 */
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

/** 交叉表：列 × 行計數。列與行的順序依總數由多到少。 */
export function crosstab(rows: ChartRow[], rowColumn: string, colColumn: string, opts: CountOptions): Crosstab {
  const rowKeys = groupCount(rows, rowColumn, opts).map((g) => g.key);
  const colKeys = groupCount(rows, colColumn, opts).map((g) => g.key);
  const key = (v: Cell) => (isBlank(v) ? BLANK_LABEL : String(v).trim());
  const cells: number[][] = rowKeys.map(() => colKeys.map(() => 0));
  const rowIdx = new Map(rowKeys.map((k, i) => [k, i]));
  const colIdx = new Map(colKeys.map((k, i) => [k, i]));
  // 以單位計數：裁判書數需依 (列, 行) 組合去重，避免同一案件被重複計算。
  const buckets = new Map<string, ChartRow[]>();
  for (const r of rows) {
    const k = `${rowIdx.get(key(r[rowColumn]))}|${colIdx.get(key(r[colColumn]))}`;
    const list = buckets.get(k);
    if (list) list.push(r);
    else buckets.set(k, [r]);
  }
  for (const [k, list] of buckets) {
    const [i, j] = k.split('|').map(Number);
    cells[i][j] = countUnits(list, opts);
  }
  // 列合計與行合計各自依所選單位去重（同一裁判書跨格時，不會在合計中被重複計算）。
  const rowTotals = groupCount(rows, rowColumn, opts).reduce<Record<string, number>>((acc, g) => ({ ...acc, [g.key]: g.count }), {});
  const colTotals = groupCount(rows, colColumn, opts).reduce<Record<string, number>>((acc, g) => ({ ...acc, [g.key]: g.count }), {});
  return {
    rowLabels: rowKeys,
    colLabels: colKeys,
    cells,
    rowTotals: rowKeys.map((k) => rowTotals[k]),
    colTotals: colKeys.map((k) => colTotals[k]),
    total: countUnits(rows, opts),
  };
}

/** 依欄位值篩選（每個欄位可指定允許的值；空陣列或未指定表示不篩）。 */
export function filterRows(rows: ChartRow[], allowed: Record<string, string[]>): ChartRow[] {
  const entries = Object.entries(allowed).filter(([, vals]) => vals.length > 0);
  if (!entries.length) return rows;
  return rows.filter((r) => entries.every(([col, vals]) => vals.includes(isBlank(r[col]) ? BLANK_LABEL : String(r[col]).trim())));
}

export interface AmountBracket {
  label: string;
  /** 含下界、不含上界；最低級距下界為 -Infinity，最高級距上界為 Infinity。 */
  lo: number;
  hi: number;
}

/** 訴訟標的金額級距（與參考平台一致）：未滿 10 萬、10 至 50 萬、50 至 100 萬、100 至 500 萬、500 萬至 1000 萬、1000 萬以上。 */
export const AMOUNT_BRACKETS: AmountBracket[] = [
  { label: '未滿 10 萬', lo: -Infinity, hi: 100_000 },
  { label: '10 至 50 萬', lo: 100_000, hi: 500_000 },
  { label: '50 至 100 萬', lo: 500_000, hi: 1_000_000 },
  { label: '100 至 500 萬', lo: 1_000_000, hi: 5_000_000 },
  { label: '500 萬至 1000 萬', lo: 5_000_000, hi: 10_000_000 },
  { label: '1000 萬以上', lo: 10_000_000, hi: Infinity },
];

/** 金額所屬級距（半開區間 [下界, 上界)：正好 10 萬屬於「10 至 50 萬」，正好 100 萬屬於「100 至 500 萬」）。無法解析或為負數回傳 null。 */
export function amountBracket(amount: Cell): string | null {
  const n = toNumber(amount);
  if (n === null || n < 0) return null;
  const hit = AMOUNT_BRACKETS.find((b) => n >= b.lo && n < b.hi);
  return hit ? hit.label : null;
}

/** 把金額欄位換成級距欄位，回傳新列（不改動原列）。 */
export function withAmountBracket(rows: ChartRow[], amountColumn: string, outColumn = '標的金額級距'): ChartRow[] {
  return rows.map((r) => ({ ...r, [outColumn]: amountBracket(r[amountColumn]) ?? BLANK_LABEL }));
}

/** 圖表來源說明：檔名、篩選條件、列數與裁判書數的區別，供每張圖標示。 */
export function sourceNote(input: { fileName: string; filters: Record<string, string[]>; rowCount: number; judgmentCount: number | null; unit: CountUnit }): string {
  const f = Object.entries(input.filters).filter(([, v]) => v.length).map(([k, v]) => `${k}＝${v.join('、')}`);
  const parts = [`資料來源：${input.fileName}`, f.length ? `篩選：${f.join('；')}` : '篩選：無', `列數 ${input.rowCount}`];
  if (input.judgmentCount !== null) parts.push(`裁判書數 ${input.judgmentCount}`);
  parts.push(`計數單位：${input.unit === 'judgments' ? '裁判書數（依 ID 去重）' : '列數'}`);
  return parts.join('｜');
}
