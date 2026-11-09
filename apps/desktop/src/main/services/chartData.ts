// 量化圖表（issue #8）的桌面端資料層：讀取 Excel、欄位型態覆寫、依設定組出圖表（SVG／交叉表 HTML）。
// 純函式與讀檔函式分開：純函式不依賴 Electron，可直接以 node 測試；讀檔只在 readChartWorkbook / loadChartSheet。
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import {
  AMOUNT_BRACKETS, BLANK_LABEL, barChartSvg, columnKinds, courtTileOf, crosstab, crosstabHtml, escapeXml,
  filterRows, groupCount, inferColumnKind, isBlank, sourceNote, stackedBarSvg, tileMapSvg, toNumber, violinSvg,
  withAmountBracket, type Cell, type ChartRow, type ColumnKind, type Crosstab, type CountOptions, type CountUnit, type TileValue,
} from '@judge/core';

export type ChartType = 'bar' | 'stacked' | 'violin' | 'crosstab' | 'tiles';

export const CHART_TYPES: ChartType[] = ['bar', 'stacked', 'violin', 'crosstab', 'tiles'];
const KINDS: ColumnKind[] = ['number', 'date', 'category', 'empty'];

const AMOUNT_COLUMN = '標的金額級距';
/** 小提琴圖最多畫幾個分組（罪名）；其餘依件數排序後略過並於警示列出。 */
const MAX_VIOLIN_GROUPS = 12;
/** 堆疊圖的分段上限；超過時其餘合併為「其他」（避免圖例溢出畫面）。 */
const MAX_STACK_SERIES = 6;

export interface ChartSheet {
  name: string;
  headers: string[];
  rows: ChartRow[];
}

export interface ChartWorkbook {
  fileName: string;
  sheets: ChartSheet[];
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  headers: string[];
  /** 依資料推斷的欄位型態（不含使用者覆寫）。 */
  kinds: Record<string, ColumnKind>;
  /** 依欄位名稱的常見寫法給出的預設欄位（使用者可改）。 */
  suggested: SuggestedColumns;
}

export interface SuggestedColumns {
  id: string | null;
  court: string | null;
  cause: string | null;
  caseType: string | null;
  charge: string | null;
  lawyer: string | null;
  outcome: string | null;
  amount: string | null;
  term: string | null;
}

export interface ChartConfig {
  type: ChartType;
  unit: CountUnit;
  title: string;
  idColumn: string | null;
  /** 類別欄：長條的類別、堆疊的列、小提琴的分組（罪名）、地圖的法院。 */
  category: string | null;
  /** 分組欄：長條的堆疊分組、堆疊的分段、交叉表的行。 */
  series: string | null;
  /** 數值欄：小提琴的刑期；地圖的律師代理欄。 */
  value: string | null;
  /** 金額欄：交叉表的列以級距表示。 */
  amount: string | null;
  percent: boolean;
  filters: Record<string, string[]>;
  kindOverrides: Record<string, ColumnKind>;
}

export interface ChartResult {
  title: string;
  /** 完整 SVG（含來源說明），可直接顯示與匯出。 */
  svg: string;
  /** 交叉表的 HTML 表格（僅交叉表）。 */
  html: string | null;
  note: string;
  rowCount: number;
  judgmentCount: number | null;
  warnings: string[];
}

// ---------- 純函式 ----------

/** 把 ExcelJS 的儲存格值轉為圖表用的值（日期、公式結果、富文字、超連結皆取出可讀內容）。 */
export function normalizeCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const mm = String(v.getMonth() + 1).padStart(2, '0');
    const dd = String(v.getDate()).padStart(2, '0');
    return `${v.getFullYear()}-${mm}-${dd}`;
  }
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return normalizeCell(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => String(t?.text ?? '')).join('');
    if ('text' in o) return normalizeCell(o.text);
    if ('error' in o) return null;
  }
  return String(v);
}

/** 表頭去重：空白表頭改為「欄N」，重複名稱加上「 (2)」「 (3)」。 */
export function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let base = isBlank(h as Cell) ? `欄${i + 1}` : String(h).trim();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** 合併推斷與使用者覆寫的欄位型態（覆寫優先）。 */
export function effectiveKinds(inferred: Record<string, ColumnKind>, overrides: Record<string, ColumnKind>): Record<string, ColumnKind> {
  const out = { ...inferred };
  for (const [col, kind] of Object.entries(overrides)) if (col in out) out[col] = kind;
  return out;
}

/** 依欄位名稱的常見寫法猜測預設欄位（只看名稱與型態，不看內容）。找不到回傳 null。 */
export function suggestColumns(headers: string[], kinds: Record<string, ColumnKind>): SuggestedColumns {
  const find = (re: RegExp, kind?: ColumnKind): string | null =>
    headers.find((h) => re.test(h) && (!kind || kinds[h] === kind)) ?? null;
  return {
    id: find(/裁判書?(ID|id|編號)|^ID$|^id$|字號|案號|判決編號/),
    court: find(/法院/),
    cause: find(/案由/),
    caseType: find(/案件(類型|類別|分類)|類型|類別/),
    charge: find(/罪名|法條/),
    lawyer: find(/律師|代理/),
    outcome: find(/終結/),
    amount: find(/金額|標的/, 'number') ?? find(/金額|標的/),
    term: find(/刑期|刑度|月數/, 'number') ?? find(/刑期|刑度|月數/),
  };
}

/** 律師代理欄的判斷：含「有」且不含「無」即視為有律師代理（例如「雙方有律師」「僅原告有律師」）。空白視為無代理。 */
export function isRepresented(v: Cell): boolean {
  if (isBlank(v)) return false;
  const s = String(v);
  if (s.includes('無')) return false;
  return s.includes('有') || s.trim() === '是';
}

/** 依所選單位計數：裁判書數為 ID 去重（空 ID 不計），列數為列數。 */
export function countUnits(rows: ChartRow[], unit: CountUnit, idColumn: string | null): number {
  if (unit === 'rows') return rows.length;
  if (!idColumn) throw new Error('以裁判書數計算時，請選擇裁判書 ID 欄');
  const ids = new Set<string>();
  for (const r of rows) if (!isBlank(r[idColumn])) ids.add(String(r[idColumn]).trim());
  return ids.size;
}

export function unitLabel(unit: CountUnit): string {
  return unit === 'judgments' ? '裁判書數（依 ID 去重）' : '列數';
}

const UNIT_SHORT: Record<CountUnit, string> = { judgments: '裁判書數', rows: '列數' };

/** 在 SVG 底部加上來源說明（每個「｜」分隔的片段一行），並增加畫布高度。 */
export function withSourceNote(svg: string, note: string): string {
  const m = /height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!m) return svg;
  const h = Number(m[1]);
  const lines = note.split('｜').map((s) => s.trim()).filter(Boolean);
  const newH = h + 14 + lines.length * 16;
  const texts = lines.map((line, i) => `<text x="16" y="${h + 22 + i * 16}" font-size="11" fill="#57606a">${escapeXml(line)}</text>`).join('');
  return svg
    .replace(m[0], `height="${newH}" viewBox="0 0 ${m[2]} ${newH}"`)
    .replace(/<\/svg>\s*$/, `${texts}</svg>`);
}

/** 交叉表的 SVG（供匯出；畫面上仍以 HTML 表格顯示）。 */
export function crosstabSvg(ct: Crosstab, opts: { title: string; rowTitle: string; colTitle: string; unitLabel: string }): string {
  const labelW = 180;
  const colW = 120;
  const rowH = 28;
  const cols = ct.colLabels.length;
  const width = Math.max(480, labelW + colW * (cols + 1) + 32);
  const top = 56;
  const parts: string[] = [`<text x="16" y="28" font-size="16" font-weight="600" fill="#1f2328">${escapeXml(opts.title)}</text>`];
  const cell = (x: number, y: number, w: number, text: string, bold = false, align = 'middle') => {
    const tx = align === 'start' ? x + 6 : x + w / 2;
    return `<rect x="${x}" y="${y}" width="${w}" height="${rowH}" fill="${bold ? '#f6f8fa' : '#ffffff'}" stroke="#d0d7de"/>`
      + `<text x="${tx}" y="${y + 18}" font-size="12" text-anchor="${align === 'start' ? 'start' : 'middle'}" fill="#1f2328"${bold ? ' font-weight="600"' : ''}>${escapeXml(text)}</text>`;
  };
  let y = top;
  parts.push(cell(16, y, labelW, `${opts.rowTitle} ＼ ${opts.colTitle}`, true, 'start'));
  ct.colLabels.forEach((c, j) => parts.push(cell(16 + labelW + j * colW, y, colW, c, true)));
  parts.push(cell(16 + labelW + cols * colW, y, colW, '合計', true));
  y += rowH;
  ct.rowLabels.forEach((r, i) => {
    parts.push(cell(16, y, labelW, r, true, 'start'));
    ct.cells[i].forEach((v, j) => {
      const pct = ct.rowTotals[i] ? ((v / ct.rowTotals[i]) * 100).toFixed(1) : '0.0';
      parts.push(cell(16 + labelW + j * colW, y, colW, `${v}（${pct}%）`));
    });
    parts.push(cell(16 + labelW + cols * colW, y, colW, String(ct.rowTotals[i]), true));
    y += rowH;
  });
  parts.push(cell(16, y, labelW, '合計', true, 'start'));
  ct.colTotals.forEach((v, j) => parts.push(cell(16 + labelW + j * colW, y, colW, String(v), true)));
  parts.push(cell(16 + labelW + cols * colW, y, colW, String(ct.total), true));
  y += rowH;
  parts.push(`<text x="16" y="${y + 20}" font-size="11" fill="#57606a">單位：${escapeXml(opts.unitLabel)}（每列括號內為列百分比）</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y + 40}" viewBox="0 0 ${width} ${y + 40}" font-family="'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
}

/** 依指定順序重排交叉表的列（不在順序表中的列排最後）。 */
export function orderCrosstabRows(ct: Crosstab, order: string[]): Crosstab {
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const idx = ct.rowLabels.map((_, i) => i).sort((a, b) => rank(ct.rowLabels[a]) - rank(ct.rowLabels[b]) || a - b);
  return {
    ...ct,
    rowLabels: idx.map((i) => ct.rowLabels[i]),
    cells: idx.map((i) => ct.cells[i]),
    rowTotals: idx.map((i) => ct.rowTotals[i]),
  };
}

/** 分段過多時保留件數最多的前 N 段，其餘合併為「其他」。 */
function limitSeries(ct: Crosstab, max: number): { name: string; values: number[] }[] {
  const all = ct.colLabels.map((name, j) => ({ name, values: ct.cells.map((r) => r[j]), total: ct.colTotals[j] }));
  const sorted = [...all].sort((a, b) => b.total - a.total);
  if (sorted.length <= max) return all.map(({ name, values }) => ({ name, values }));
  const keep = new Set(sorted.slice(0, max).map((s) => s.name));
  const kept = all.filter((s) => keep.has(s.name)).map(({ name, values }) => ({ name, values }));
  const rest = all.filter((s) => !keep.has(s.name));
  const other = ct.rowLabels.map((_, i) => rest.reduce((acc, s) => acc + s.values[i], 0));
  return [...kept, { name: '其他', values: other }];
}

function valueKindError(col: string): Error {
  return new Error(`數值欄「${col}」目前被判為非數值，無法繪製小提琴圖或計算率；請在欄位型態改為「數值」（非數字的儲存格會略過）。`);
}

/** 依設定組出圖表：篩選 → 計數 → 繪圖。所有錯誤以使用者可讀的中文訊息拋出。 */
export function buildChartResult(input: { sheet: ChartSheet; fileName: string; config: ChartConfig; inferredKinds: Record<string, ColumnKind> }): ChartResult {
  const { sheet, fileName, config: cfg } = input;
  const kinds = effectiveKinds(input.inferredKinds, cfg.kindOverrides);
  const need = (col: string | null, label: string): string => {
    if (!col) throw new Error(`請選擇${label}`);
    if (!sheet.headers.includes(col)) throw new Error(`找不到欄位「${col}」`);
    return col;
  };
  if (!CHART_TYPES.includes(cfg.type)) throw new Error(`未知的圖表類型：${cfg.type}`);
  if (cfg.unit === 'judgments' && !cfg.idColumn) throw new Error('以裁判書數計算時，請選擇裁判書 ID 欄');
  if (cfg.idColumn) need(cfg.idColumn, '裁判書 ID 欄');

  const warnings: string[] = [];
  const rows = filterRows(sheet.rows, cfg.filters);
  const opts: CountOptions = { unit: cfg.unit, idColumn: cfg.idColumn ?? undefined };
  const judgmentCount = cfg.idColumn ? countUnits(rows, 'judgments', cfg.idColumn) : null;
  const unitShort = UNIT_SHORT[cfg.unit];
  const defaults: Record<ChartType, string> = {
    bar: '案由分布', stacked: '堆疊圖', violin: '刑期分布', crosstab: '交叉表', tiles: '各法院律師代理率',
  };
  const title = `${cfg.title.trim() || defaults[cfg.type]}（${unitShort}）`;
  const uLabel = unitLabel(cfg.unit);
  let svg: string;
  let html: string | null = null;

  if (cfg.type === 'bar') {
    const cat = need(cfg.category, '類別欄');
    if (cfg.series) {
      const series = need(cfg.series, '分組欄');
      const ct = crosstab(rows, cat, series, opts);
      svg = stackedBarSvg({
        title, categories: ct.rowLabels, series: limitSeries(ct, MAX_STACK_SERIES), percent: false, unitLabel: uLabel,
      });
    } else {
      const items = groupCount(rows, cat, opts).map((g) => ({ label: g.key, value: g.count }));
      svg = barChartSvg({ title, items, unitLabel: uLabel });
    }
  } else if (cfg.type === 'stacked') {
    const cat = need(cfg.category, '列欄');
    const series = need(cfg.series, '分段欄');
    const ct = crosstab(rows, cat, series, opts);
    svg = stackedBarSvg({
      title, categories: ct.rowLabels, series: limitSeries(ct, MAX_STACK_SERIES), percent: cfg.percent, unitLabel: uLabel,
    });
  } else if (cfg.type === 'violin') {
    const group = need(cfg.category, '分組欄（罪名）');
    const value = need(cfg.value, '數值欄（刑期）');
    if (kinds[value] !== 'number') throw valueKindError(value);
    const seen = new Set<string>();
    const byGroup = new Map<string, number[]>();
    let skipped = 0;
    for (const r of rows) {
      const g = isBlank(r[group]) ? BLANK_LABEL : String(r[group]).trim();
      const n = toNumber(r[value]);
      if (n === null) {
        if (!isBlank(r[value])) skipped++;
        continue;
      }
      if (cfg.unit === 'judgments') {
        // 裁判書數：同一裁判書同一分組只取一筆（同一判決可能有多個罪名列）。
        const key = `${String(r[cfg.idColumn!] ?? '').trim()}\u0001${g}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const list = byGroup.get(g);
      if (list) list.push(n);
      else byGroup.set(g, [n]);
    }
    if (skipped) warnings.push(`數值欄有 ${skipped} 筆無法解析為數字，已略過。`);
    const groups = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-Hant'));
    if (groups.length > MAX_VIOLIN_GROUPS) warnings.push(`分組共 ${groups.length} 類，僅繪製件數最多的前 ${MAX_VIOLIN_GROUPS} 類。`);
    svg = violinSvg({
      title,
      groups: groups.slice(0, MAX_VIOLIN_GROUPS).map(([label, values]) => ({ label, values })),
      yLabel: value,
      unitLabel: uLabel,
    });
  } else if (cfg.type === 'crosstab') {
    const colCol = need(cfg.series, '行欄（例如律師代理）');
    let work = rows;
    let rowCol: string;
    if (cfg.amount) {
      const amount = need(cfg.amount, '金額欄');
      if (kinds[amount] !== 'number') throw valueKindError(amount);
      work = withAmountBracket(rows, amount, AMOUNT_COLUMN);
      rowCol = AMOUNT_COLUMN;
      const blanks = work.filter((r) => r[AMOUNT_COLUMN] === BLANK_LABEL).length;
      if (blanks) warnings.push(`金額無法解析的列有 ${blanks} 筆，歸入「${BLANK_LABEL}」。`);
    } else {
      rowCol = need(cfg.category, '列欄');
    }
    const ct0 = crosstab(work, rowCol, colCol, opts);
    const ct = cfg.amount ? orderCrosstabRows(ct0, AMOUNT_BRACKETS.map((b) => b.label)) : ct0;
    html = crosstabHtml(ct, { rowTitle: rowCol, colTitle: colCol, percentByRow: true });
    svg = crosstabSvg(ct, { title, rowTitle: rowCol, colTitle: colCol, unitLabel: uLabel });
  } else {
    const court = need(cfg.category, '法院欄');
    const law = need(cfg.value, '律師代理欄');
    const byCourt = new Map<string, { all: ChartRow[]; rep: ChartRow[] }>();
    for (const r of rows) {
      const k = isBlank(r[court]) ? BLANK_LABEL : String(r[court]).trim();
      const b = byCourt.get(k) ?? { all: [], rep: [] };
      b.all.push(r);
      if (isRepresented(r[law])) b.rep.push(r);
      byCourt.set(k, b);
    }
    const values: TileValue[] = [];
    let unmapped = 0;
    for (const [name, b] of byCourt) {
      if (!courtTileOf(name)) { unmapped++; continue; }
      const total = countUnits(b.all, cfg.unit, cfg.idColumn);
      const rep = countUnits(b.rep, cfg.unit, cfg.idColumn);
      values.push({ court: name, value: total ? (rep / total) * 100 : null, n: total });
    }
    if (unmapped) warnings.push(`有 ${unmapped} 個法院無法對應格狀地圖（僅地方法院），已略過。`);
    if (rows.some((r) => isBlank(r[law]))) warnings.push('律師代理欄有空白，空白視為無律師代理。');
    svg = tileMapSvg({ title, subtitle: '示意格狀地圖：每格為一個地方法院，非比例地圖', values, valueLabel: '律師代理率' });
  }

  const note = sourceNote({ fileName, filters: cfg.filters, rowCount: rows.length, judgmentCount, unit: cfg.unit });
  return { title, svg: withSourceNote(svg, note), html, note, rowCount: rows.length, judgmentCount, warnings };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** 畫面傳來的設定不可信：逐欄檢查型別，未知值一律丟棄。 */
export function sanitizeChartConfig(raw: any): ChartConfig {
  const type: ChartType = CHART_TYPES.includes(raw?.type) ? raw.type : 'bar';
  const unit: CountUnit = raw?.unit === 'rows' ? 'rows' : 'judgments';
  const filters: Record<string, string[]> = {};
  if (raw?.filters && typeof raw.filters === 'object') {
    for (const [col, vals] of Object.entries(raw.filters)) {
      if (!col || !Array.isArray(vals)) continue;
      const list = vals.filter((x): x is string => typeof x === 'string' && x !== '');
      if (list.length) filters[col] = list;
    }
  }
  const kindOverrides: Record<string, ColumnKind> = {};
  if (raw?.kindOverrides && typeof raw.kindOverrides === 'object') {
    for (const [col, k] of Object.entries(raw.kindOverrides)) {
      if (KINDS.includes(k as ColumnKind)) kindOverrides[col] = k as ColumnKind;
    }
  }
  return {
    type,
    unit,
    title: typeof raw?.title === 'string' ? raw.title.slice(0, 120) : '',
    idColumn: str(raw?.idColumn),
    category: str(raw?.category),
    series: str(raw?.series),
    value: str(raw?.value),
    amount: str(raw?.amount),
    percent: raw?.percent === true,
    filters,
    kindOverrides,
  };
}

// ---------- 讀檔（有快取；同一檔案只解析一次） ----------

const CACHE_LIMIT = 2;
const cache = new Map<string, ChartWorkbook>();

async function loadWorkbook(filePath: string): Promise<ChartWorkbook> {
  const stat = await fs.stat(filePath);
  const key = `${path.resolve(filePath)}|${stat.mtimeMs}|${stat.size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheets: ChartSheet[] = wb.worksheets.map((ws) => {
    const width = Math.max(ws.columnCount, 0);
    const rawHeaders: unknown[] = [];
    const headerRow = ws.getRow(1);
    for (let c = 1; c <= width; c++) rawHeaders.push(normalizeCell(headerRow.getCell(c).value));
    const headers = uniqueHeaders(rawHeaders);
    const rows: ChartRow[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const obj: ChartRow = {};
      let any = false;
      headers.forEach((h, i) => {
        const v = normalizeCell(row.getCell(i + 1).value);
        obj[h] = v;
        if (!isBlank(v)) any = true;
      });
      if (any) rows.push(obj);
    }
    return { name: ws.name, headers, rows };
  });
  const out: ChartWorkbook = { fileName: path.basename(filePath), sheets };
  cache.set(key, out);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return out;
}

/** 列出工作表、表頭、列數與欄位型態（不回傳列內容，供畫面選擇用）。 */
export async function inspectChartWorkbook(filePath: string): Promise<{ fileName: string; sheets: SheetSummary[] }> {
  const wb = await loadWorkbook(filePath);
  return {
    fileName: wb.fileName,
    sheets: wb.sheets.map((s) => {
      const kinds = columnKinds(s.rows, s.headers);
      return { name: s.name, rowCount: s.rows.length, headers: s.headers, kinds, suggested: suggestColumns(s.headers, kinds) };
    }),
  };
}

/** 取得單一工作表（含列內容），供繪圖使用。 */
export async function loadChartSheet(filePath: string, sheetName: string): Promise<{ fileName: string; sheet: ChartSheet; inferredKinds: Record<string, ColumnKind> }> {
  const wb = await loadWorkbook(filePath);
  const sheet = wb.sheets.find((s) => s.name === sheetName);
  if (!sheet) throw new Error(`找不到工作表「${sheetName}」`);
  const inferredKinds = Object.fromEntries(sheet.headers.map((h) => [h, inferColumnKind(sheet.rows.map((r) => r[h]))])) as Record<string, ColumnKind>;
  return { fileName: wb.fileName, sheet, inferredKinds };
}

