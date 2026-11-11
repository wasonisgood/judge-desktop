// 任意格式檔案匯入（主程序）：讀取 Excel、CSV、TSV、TXT、Word、PDF，由 AI 判斷標題列與各欄位的意思，
// 再整理成判決清單。不限制格式、不要求使用者先整理成固定欄位。
// 原則：
// 1. 讀取只做格式解析（不猜欄位意思）；欄位含義一律交給 AI 判斷，AI 回傳的欄號會再檢查是否在範圍內。
// 2. 沒有字號的列直接略過；字號可由文字中以規則抽出（這是字號格式，不是欄位猜測）。
// 3. 純函式（normalizeRows、normalizeDate、sanitizeMapping）與檔案讀取分開，方便測試。
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import { parseCsv, openPdf, extractPageTexts, parseJsonReply, type AiComplete } from '@judge/core';
import { courtOf } from './resultCharts';

// adm-zip 是既有依賴，以 CommonJS 方式載入（與 engineInstaller.ts 相同）。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip: new (file: Buffer) => { getEntry(name: string): { getData(): Buffer } | null } = require('adm-zip');

export const IMPORT_EXTENSIONS = ['xlsx', 'csv', 'tsv', 'txt', 'docx', 'pdf'];
const SAMPLE_ROWS = 15;
const MAX_ROWS = 20000;

export interface ColumnMapping {
  /** 標題列的列號（從 0 開始）；沒有標題列為 null。 */
  headerRow: number | null;
  caseNo: number | null;
  title: number | null;
  court: number | null;
  dateIso: number | null;
  cause: number | null;
  href: number | null;
}

export interface ImportedItem {
  id: string;
  title: string;
  court: string;
  dateIso: string | null;
  cause: string;
  href: string;
}

const CASE_NO_RE = /\d{2,3}\s*年度\s*[^\s，,、。；;]{1,8}?\s*字第\s*\d+\s*號/;

// ---------------------------------------------------------------------------
// 純函式
// ---------------------------------------------------------------------------

/** 日期正規化：支援 2026-01-05、2026/1/5、民國 115/01/05、115年1月5日。無法辨識回傳 null。 */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (y: number, m: number, d: number): string | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  };
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{2,3})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/.exec(s);
  if (m) return ymd(Number(m[1]) + 1911, Number(m[2]), Number(m[3]));
  return null;
}

/** 從一段文字找出第一個日期（用於沒有日期欄的文字列）。 */
export function dateFromText(text: string): string | null {
  const m = /(\d{2,4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/.exec(text);
  if (!m) return null;
  const y = Number(m[1]);
  const year = y < 1000 ? y + 1911 : y; // 三位數為民國年
  return normalizeDate(`${year}-${m[2]}-${m[3]}`);
}

/** 從判決網址或判決 ID 取出判決 id（司法院網址的 id 參數，或 TPSV_… 形式的 ID）。 */
export function judgmentIdFrom(href: string): string | null {
  const q = /[?&]id=([A-Za-z0-9_\-]+)/.exec(href);
  if (q) return q[1];
  const bare = /^[A-Z]{2,6}_\d+[A-Za-z0-9_\-]*$/.exec(href.trim());
  return bare ? bare[0] : null;
}

/** AI 回傳的欄位對照：只保留範圍內的欄號，列號需在資料列範圍內。 */
export function sanitizeMapping(raw: unknown, rowCount: number, colCount: number): ColumnMapping {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const col = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < colCount ? (v as number) : null);
  const headerRaw = r.headerRow;
  const headerRow = Number.isInteger(headerRaw) && (headerRaw as number) >= 0 && (headerRaw as number) < rowCount ? (headerRaw as number) : null;
  return {
    headerRow,
    caseNo: col(r.caseNo),
    title: col(r.title),
    court: col(r.court),
    dateIso: col(r.dateIso),
    cause: col(r.cause),
    href: col(r.href),
  };
}

/** 依欄位對照把資料列整理成判決清單：沒有字號的列略過；以判決 id（或字號）去重。 */
export function normalizeRows(rows: string[][], map: ColumnMapping): ImportedItem[] {
  const start = map.headerRow !== null ? map.headerRow + 1 : 0;
  const seen = new Set<string>();
  const out: ImportedItem[] = [];
  for (let i = start; i < rows.length && out.length < MAX_ROWS; i++) {
    const row = rows[i] ?? [];
    const cell = (idx: number | null): string => (idx === null ? '' : String(row[idx] ?? '').trim());
    const joined = row.map((c) => String(c ?? '')).join(' ');
    // 字號先看字號欄（或標題欄），再看整列；只有符合字號格式的才算判決。
    const hit = CASE_NO_RE.exec(cell(map.caseNo) || cell(map.title)) ?? CASE_NO_RE.exec(joined);
    if (!hit) continue;
    const caseNo = hit[0].replace(/\s+/g, ' ');
    const title = cell(map.title) || caseNo;
    const href = cell(map.href);
    const id = (href && judgmentIdFrom(href)) || caseNo;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: title.replace(/\s+/g, ' ').slice(0, 200),
      court: cell(map.court) || courtOf(title) || courtOf(caseNo),
      dateIso: normalizeDate(cell(map.dateIso)) || dateFromText(joined),
      cause: cell(map.cause).slice(0, 80),
      href,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 讀取：各格式轉成「列 × 欄」的字串表
// ---------------------------------------------------------------------------

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('');
    if (o.result !== undefined) return cellText(o.result);
    if (typeof o.text === 'string') return o.text;
  }
  return String(v);
}

function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('big5').decode(buf);
  }
}

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

/** Word：表格的每一列為一列（儲存格以欄為單位），其餘段落每段為一列。 */
export function docxRows(documentXml: string): string[][] {
  const rows: string[][] = [];
  const tableRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const paragraphs = (chunk: string) => {
    for (const p of chunk.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      const t = xmlText(p);
      if (t) rows.push([t]);
    }
  };
  while ((m = tableRe.exec(documentXml))) {
    paragraphs(documentXml.slice(last, m.index));
    for (const tr of m[0].match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
      rows.push((tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((tc) => xmlText(tc)));
    }
    last = m.index + m[0].length;
  }
  paragraphs(documentXml.slice(last));
  return rows;
}

export async function readAnyTable(file: string): Promise<string[][]> {
  const ext = path.extname(file).toLowerCase().replace('.', '');
  const buf = Buffer.from(await fsp.readFile(file));
  if (ext === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const cols = Math.max(ws.columnCount, 1);
    const rows: string[][] = [];
    for (let r = 1; r <= ws.rowCount && rows.length < MAX_ROWS; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= cols; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    }
    return rows;
  }
  if (ext === 'csv') return parseCsv(decodeText(buf));
  if (ext === 'tsv') return decodeText(buf).split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
  if (ext === 'txt') return decodeText(buf).split(/\r?\n/).filter((l) => l.trim()).map((l) => [l.trim()]);
  if (ext === 'docx') {
    const entry = new AdmZip(buf).getEntry('word/document.xml');
    if (!entry) throw new Error('這個 Word 檔看不到內容（可能不是 .docx 格式）。');
    return docxRows(entry.getData().toString('utf8'));
  }
  if (ext === 'pdf') {
    // core 的 openPdf 型別來自另一組 Node 型別定義，這裡轉型（執行時期的值相同）。
    const doc = await openPdf(buf as unknown as Parameters<typeof openPdf>[0]);
    const pages = await extractPageTexts(doc);
    const rows: string[][] = [];
    for (const p of pages) {
      for (const line of p.text.split(/\n|\r/)) if (line.trim()) rows.push([line.trim()]);
    }
    return rows;
  }
  throw new Error(`不支援的檔案格式：.${ext || '（沒有副檔名）'}。可以匯入 ${IMPORT_EXTENSIONS.map((e) => '.' + e).join('、')}。`);
}

// ---------------------------------------------------------------------------
// AI 判斷欄位
// ---------------------------------------------------------------------------

const MAP_SYSTEM = [
  '你是檔案匯入助理。下面是一份判決清單的前幾列，每列的儲存格以「｜」分隔，列號與欄號都從 0 開始。',
  '請判斷：',
  '- headerRow：哪一列是標題列（沒有標題列則為 -1）',
  '- caseNo：裁判字號所在的欄（例如「113 年度 上易 字第 1 號」）',
  '- title：判決名稱或標題所在的欄（與字號同一欄時填相同欄號；沒有則 -1）',
  '- court：法院所在的欄',
  '- dateIso：裁判日期所在的欄',
  '- cause：案由所在的欄',
  '- href：判決網址或判決 ID 所在的欄',
  '沒有對應的欄位填 -1。只輸出一個 JSON 物件，鍵只能是上述七個，不要其他說明。',
].join('\n');

function sampleText(rows: string[][]): string {
  return rows.slice(0, SAMPLE_ROWS).map((r, i) => `列${i}：` + r.map((c, j) => `[欄${j}]${String(c ?? '').replace(/\s+/g, ' ').slice(0, 60)}`).join('｜')).join('\n');
}

export async function aiMapColumns(ai: AiComplete, rows: string[][]): Promise<ColumnMapping> {
  const colCount = Math.max(0, ...rows.slice(0, SAMPLE_ROWS).map((r) => r.length));
  const raw = await ai(MAP_SYSTEM, sampleText(rows), 400);
  const parsed = parseJsonReply<Record<string, unknown>>(raw);
  const normalized: Record<string, unknown> = { ...parsed };
  for (const k of Object.keys(normalized)) if (normalized[k] === -1) normalized[k] = null;
  return sanitizeMapping(normalized, Math.min(rows.length, SAMPLE_ROWS), colCount);
}

export interface ImportResult {
  items: ImportedItem[];
  mapping: ColumnMapping;
  rowCount: number;
}

/** 讀取檔案 → AI 判斷欄位 → 整理成判決清單。找不到任何字號時明確報錯。 */
export async function importTableFile(file: string, ai: AiComplete): Promise<ImportResult> {
  const rows = await readAnyTable(file);
  if (rows.length === 0) throw new Error('檔案沒有可讀取的內容。');
  const mapping = await aiMapColumns(ai, rows);
  const items = normalizeRows(rows, mapping);
  if (items.length === 0) throw new Error('無法從檔案找出裁判字號。請確認檔案確實是判決清單，或換一個檔案。');
  return { items, mapping, rowCount: rows.length };
}

// ---------------------------------------------------------------------------
// 文本擷取：非標準清單轉成標準清單（Index／Title／URL）
// ---------------------------------------------------------------------------

/** 是否已是文本擷取的標準清單（表頭含 Title 與 URL）。 */
export async function isStandardCrawlList(file: string): Promise<boolean> {
  if (!/\.(xlsx|csv)$/i.test(file)) return false;
  const rows = await readAnyTable(file);
  const header = (rows[0] ?? []).map((c) => String(c).trim());
  return header.includes('Title') && header.includes('URL');
}

/** 寫入標準清單到與原檔相同的資料夾（同名加 _2、_3，不覆蓋既有檔案）。 */
export async function writeStandardCrawlList(sourceFile: string, items: ImportedItem[]): Promise<string> {
  const dir = path.dirname(sourceFile);
  const base = path.basename(sourceFile, path.extname(sourceFile));
  let out = path.join(dir, `${base}_清單.xlsx`);
  for (let n = 2; await fsp.access(out).then(() => true, () => false); n++) out = path.join(dir, `${base}_清單_${n}.xlsx`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('清單');
  ws.addRow(['Index', 'Title', 'URL']);
  items.forEach((it, i) => {
    const url = it.href || (/^[A-Z]{2,6}_\d+/.test(it.id) ? `https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=${it.id}` : '');
    ws.addRow([i + 1, it.title, url]);
  });
  await wb.xlsx.writeFile(out);
  return out;
}
