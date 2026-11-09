// 文本擷取（JudgementsCrawler 五步流程）的純函式：檔名、CSV（UTF-8 含 BOM）、清單匯入去重、列表頁數計算、歷審表列。
// 不做任何檔案或網路 I/O；桌面端負責實際讀寫。
import { BASE } from './client';
import { caseNoBase } from './finality';
import type { HistoryRow } from './history';
import type { JudgmentSummary } from './parse';

// ───── 連線間隔（設定）─────
/** 每次連線之間的間隔（秒）：預設 3，最小 3（司法院要求）。 */
export const CRAWL_DEFAULT_INTERVAL_SEC = 3;
export const CRAWL_MIN_INTERVAL_SEC = 3;

/** 把設定值正規化為整數秒，不得低於 3；無法解析時用預設值。 */
export function normalizeCrawlIntervalSec(v: unknown): number {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) return CRAWL_DEFAULT_INTERVAL_SEC;
  return Math.max(CRAWL_MIN_INTERVAL_SEC, Math.round(n));
}

// ───── Step 1：列表頁數 ─────
export const LIST_PAGE_SIZE = 20;
/** 司法院每次查詢上限：25 頁、500 筆。 */
export const LIST_MAX_PAGES = 25;
export const LIST_MAX_ITEMS = 500;

export interface ListPagePlan {
  /** 實際要抓的頁數（上限 25）。 */
  pages: number;
  pageNumbers: number[];
  /** 實際要保留的筆數（上限 500）。 */
  maxItems: number;
  /** 查詢結果的總筆數（頁面「共 N 筆」）。 */
  totalFound: number;
  /** 總筆數超過上限，只取前面的部分。 */
  truncated: boolean;
}

/** 依頁面「共 N 筆」計算要抓的頁數與筆數。 */
export function planListPages(total: number): ListPagePlan {
  const totalFound = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const pages = Math.min(Math.ceil(totalFound / LIST_PAGE_SIZE), LIST_MAX_PAGES);
  const maxItems = Math.min(totalFound, LIST_MAX_ITEMS, pages * LIST_PAGE_SIZE);
  return {
    pages,
    pageNumbers: Array.from({ length: pages }, (_, i) => i + 1),
    maxItems,
    totalFound,
    truncated: totalFound > maxItems,
  };
}

/** 從列表頁讀出「共 N 筆」的 N；讀不到回傳 null。 */
export function parseTotalCount(text: string): number | null {
  const m = /共\s*([\d,]+)\s*筆/.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 第 page 頁的列表網址（以 &page=N 翻頁，會取代既有的 page 參數）。 */
export function listPageUrl(listUrl: string, page: number): string {
  const stripped = listUrl.replace(/[?&]page=\d+/g, '');
  return `${stripped}${stripped.includes('?') ? '&' : '?'}page=${page}`;
}

// ───── 檔名 ─────
/** 同名時加 _2、_3…，不覆蓋既有檔案。exists 由呼叫端提供（例如檢查磁碟）。 */
export function uniqueName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name;
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && !/[\\/]/.test(name.slice(dot));
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  for (let n = 2; n < 100_000; n++) {
    const candidate = `${base}_${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error('無法產生不重複的檔名');
}

/** 去除不能用於檔名的字元，並限制長度。 */
export function safeFileName(s: string, max = 120): string {
  const cleaned = s.replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned || '未命名';
}

/** Step 2 的單案文本檔名（清單序號.txt）。 */
export function stepTwoFileName(index: number): string {
  return `${index}.txt`;
}

/** Step 4 的歷審文本檔名（清單序號-歷審序號.txt，例如 7-2.txt）。 */
export function stepFourFileName(index: number, historySeq: number): string {
  return `${index}-${historySeq}.txt`;
}

// ───── CSV ─────
const CSV_BOM = '﻿';

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 產生 CSV 文字：UTF-8 含 BOM（Excel 可直接開啟），列以 CRLF 分隔。 */
export function buildCsv(rows: (string | number | null | undefined)[][]): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** 解析 CSV（支援引號、引號內換行、CRLF／LF、去除 BOM）。 */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith(CSV_BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export interface CrawlLogEntry {
  index: number;
  step: string;
  title: string;
  url: string;
  ok: boolean;
  file?: string;
  /** 失敗原因（ok 為 false 時必填）。 */
  reason?: string;
}

export const CRAWL_LOG_HEADER = ['清單序號', '步驟', '字號', '網址', '結果', '檔名', '原因'];

/** 擷取紀錄 CSV（_擷取紀錄.csv）：每筆一列，失敗時寫明原因。 */
export function buildCrawlLogCsv(entries: CrawlLogEntry[]): string {
  return buildCsv([
    CRAWL_LOG_HEADER,
    ...entries.map((e) => [e.index, e.step, e.title, e.url, e.ok ? '成功' : '失敗', e.file ?? '', e.reason ?? (e.ok ? '' : '未知錯誤')]),
  ]);
}

// ───── 清單匯入（Step 2／3／5 的輸入）─────
export interface CrawlListItem {
  index: number;
  title: string;
  url: string;
  /** 網址中的 id 參數（data.aspx?id=…）。 */
  id: string;
}

export interface ListImportIssue {
  /** 試算表列號（從 1 開始，含表頭）。 */
  row: number;
  message: string;
}

export interface ListImportResult {
  items: CrawlListItem[];
  duplicates: ListImportIssue[];
  errors: ListImportIssue[];
}

const HEADER_ALIASES = {
  index: ['index', '序號', '清單序號', '編號'],
  title: ['title', '字號', '標題', '裁判字號'],
  url: ['url', '網址', '連結'],
} as const;

function findColumn(header: string[], names: readonly string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase());
  return norm.findIndex((h) => (names as readonly string[]).includes(h));
}

/** 本地日期的 YYYY-MM-DD（Step 5 計算上訴期間用）。 */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 字號去重用的鍵：去除所有空白。 */
export function titleKey(title: string): string {
  return title.replace(/\s+/g, '');
}

/**
 * 匯入清單（Step 1 的 .xlsx／.csv、列表匯出、參考平台下載的清單）。
 * 必要欄位：字號（或標題）與網址；序號欄位可省略（依列順序補上）。
 * 去重依字號（同字號第二次出現者列入 duplicates，不算錯誤）；格式錯誤逐列回報在 errors。
 */
export function parseListImport(table: (string | null | undefined)[][]): ListImportResult {
  const errors: ListImportIssue[] = [];
  const duplicates: ListImportIssue[] = [];
  const rowsAll = table.map((r) => r.map((c) => (c == null ? '' : String(c))));
  const headerAt = rowsAll.findIndex((r) => findColumn(r, HEADER_ALIASES.title) >= 0 && findColumn(r, HEADER_ALIASES.url) >= 0);
  if (headerAt < 0) {
    errors.push({ row: 1, message: '找不到表頭：需要「字號（或 Title）」與「網址（或 URL）」欄位' });
    return { items: [], duplicates, errors };
  }
  const header = rowsAll[headerAt];
  const colIndex = findColumn(header, HEADER_ALIASES.index);
  const colTitle = findColumn(header, HEADER_ALIASES.title);
  const colUrl = findColumn(header, HEADER_ALIASES.url);

  const items: CrawlListItem[] = [];
  const seenTitle = new Set<string>();
  const seenIndex = new Set<number>();
  const pendingNoIndex: CrawlListItem[] = [];

  for (let r = headerAt + 1; r < rowsAll.length; r++) {
    const cells = rowsAll[r];
    const lineNo = r + 1;
    if (cells.every((c) => c.trim() === '')) continue;
    const title = (cells[colTitle] ?? '').trim();
    const url = (cells[colUrl] ?? '').trim();
    if (!title) { errors.push({ row: lineNo, message: '缺少字號' }); continue; }
    if (!url) { errors.push({ row: lineNo, message: '缺少網址' }); continue; }
    let id = '';
    try {
      id = new URL(url, BASE).searchParams.get('id') ?? '';
    } catch {
      id = '';
    }
    if (!id) { errors.push({ row: lineNo, message: '網址格式不符（需為司法院裁判書網址，含 id 參數）' }); continue; }

    let index: number | null = null;
    const rawIndex = colIndex >= 0 ? (cells[colIndex] ?? '').trim() : '';
    if (rawIndex) {
      const n = Number(rawIndex);
      if (!Number.isInteger(n) || n <= 0) { errors.push({ row: lineNo, message: `序號格式錯誤：「${rawIndex}」` }); continue; }
      if (seenIndex.has(n)) { errors.push({ row: lineNo, message: `序號重複：${n}` }); continue; }
      index = n;
    }

    const key = titleKey(title);
    if (seenTitle.has(key)) { duplicates.push({ row: lineNo, message: `字號重複，已略過：${title}` }); continue; }
    seenTitle.add(key);

    const item: CrawlListItem = { index: index ?? 0, title, url, id };
    if (index != null) {
      seenIndex.add(index);
      items.push(item);
    } else {
      pendingNoIndex.push(item);
    }
  }

  // 沒有序號的列依順序接在最大序號之後。
  let next = items.reduce((m, it) => Math.max(m, it.index), 0);
  for (const it of pendingNoIndex) {
    next += 1;
    it.index = next;
    items.push(it);
  }
  items.sort((a, b) => a.index - b.index);
  return { items, duplicates, errors };
}

// ───── 歷審（Step 3、Step 4）─────
export interface HistoryMatch {
  status: 'matched' | 'none' | 'ambiguous';
  item: JudgmentSummary | null;
}

function typeOf(caseNo: string): string {
  const s = caseNo.replace(/\s+/g, '');
  return /判決$/.test(s) ? '判決' : /裁定$/.test(s) ? '裁定' : '';
}

/**
 * 把歷審清單中的一列對應到搜尋結果中的裁判書（歷審列印表沒有連結，只能以字號與日期比對）。
 * 完全相同的字號＋法院＋日期只有一筆才算對上；多筆或無筆都不猜。
 */
export function matchHistoryRowToItems(row: HistoryRow, items: JudgmentSummary[]): HistoryMatch {
  if (row.pending || !row.court || !row.caseNo) return { status: 'none', item: null };
  const court = row.court.replace(/\s+/g, '');
  const base = caseNoBase(row.caseNo);
  const type = typeOf(row.caseNo);
  const hits = items.filter((it) => {
    const t = it.title.replace(/\s+/g, '');
    if (!t.includes(court) || !t.includes(base)) return false;
    if (type && !t.includes(type)) return false;
    if (row.dateIso && it.dateIso && it.dateIso !== row.dateIso) return false;
    return true;
  });
  if (hits.length === 1) return { status: 'matched', item: hits[0] };
  return { status: hits.length === 0 ? 'none' : 'ambiguous', item: null };
}

export interface HistoryTableEntry {
  index: number;
  title: string;
  historyRows: HistoryRow[];
  /** 本案（清單中的這一則）在歷審中的位置；未定位時為 null。 */
  selfIndex: number | null;
  /** 各列對應的裁判書網址（由呼叫端比對後提供，未取得時為空字串）。 */
  urls?: (string | null | undefined)[];
}

export const HISTORY_TABLE_HEADER = ['清單序號', '歷審', '法院', '案號', '裁判日期', '網址', '備註'];

/**
 * Step 3 的歷審表（_歷審.xlsx）：每列一個審級；單一審級案件標為「歷審_1」並註記「自身（無歷審）」。
 * 沒有歷審資料時，本案本身仍列一列。
 */
export function buildHistoryTable(entries: HistoryTableEntry[]): (string | number)[][] {
  const out: (string | number)[][] = [HISTORY_TABLE_HEADER];
  for (const e of entries) {
    if (e.historyRows.length === 0) {
      out.push([e.index, '歷審_1', '', e.title, '', e.urls?.[0] ?? '', '自身（無歷審）']);
      continue;
    }
    const single = e.historyRows.length === 1;
    e.historyRows.forEach((r, i) => {
      const note = single ? '自身（無歷審）' : i === e.selfIndex ? '本案' : '';
      out.push([e.index, `歷審_${i + 1}`, r.court, r.caseNo, r.dateDisplay, e.urls?.[i] ?? '', note]);
    });
  }
  return out;
}

