// 文本擷取（JudgementsCrawler v2.0.1 五步流程）的執行服務。
// Step 1 取得清單 → Step 2 取得文本 → Step 3 歷審 → Step 4 歷審文本 → Step 5 確定判決。
// 輸出與參考平台一致：UTF-8 含 BOM 的 .txt、_擷取紀錄.csv、清單_歷審.xlsx、清單序號-歷審序號.txt、清單_確定判決.xlsx。
// 同名輸出加 _2、_3，不覆蓋既有成果；清單序號（Index）原樣保留，不重新排序。
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import {
  BASE, CourtClient, FINALITY_LABEL, buildCrawlLogCsv, buildHistoryTable, extractDefendants, getJudgmentDetail,
  isoDay, judgeFinality, listPageUrl, matchHistoryRowToItems, parseCsv, parseDetailHtml, parseListHtml,
  parseListImport, parseTotalCount, planListPages, safeFileName, searchJudgments, stepFourFileName,
  stepTwoFileName, uniqueName, normalizeCrawlIntervalSec,
  type CrawlListItem, type CrawlLogEntry, type FinalityHistoryItem, type HistoryRow, type HistoryTableEntry,
  type JudgmentSummary, type ListImportIssue,
} from '@judge/core';
import { exportDir } from './exportService';
import { readSettings } from '../data/local/settingsStore';
import {
  CRAWL_INTERVAL_MS, historySeqOf, isCancelled, isHistoryHeader, outputBase, reasonOf, runItems,
} from './crawlRunner';

export interface CrawlRunArgs {
  step: 1 | 2 | 3 | 4 | 5;
  /** Step 1：查詢關鍵字或司法院查詢結果網址；Step 2–5：輸入清單檔的路徑。 */
  input: string;
  /** Step 5：上訴期間（天），未提供時為 120。 */
  appealDays?: number;
  /** 診斷用上限（煙霧測試）：Step 1 最多抓幾頁；畫面不提供，正式流程不設定。 */
  limitPages?: number;
  /** 診斷用上限（煙霧測試）：Step 2 最多處理幾筆；畫面不提供，正式流程不設定。 */
  limitItems?: number;
}

export interface CrawlProgress {
  step: number;
  done: number;
  total: number;
  label: string;
}

export interface CrawlRunResult {
  step: number;
  outputs: string[];
  ok: number;
  failed: number;
  message: string;
}

type ProgressFn = (p: CrawlProgress) => void;

const bom = (text: string) => '﻿' + text;
const absUrl = (url: string) => new URL(url, BASE).toString();
const idOf = (url: string) => {
  try { return new URL(url, BASE).searchParams.get('id') ?? ''; } catch { return ''; }
};

/** 依設定的連線間隔（秒，最小 3）建立客戶端；每次執行開始時讀取一次。 */
async function newClient(signal: AbortSignal): Promise<CourtClient> {
  const s = await readSettings();
  const sec = normalizeCrawlIntervalSec(s.crawlIntervalSec);
  return new CourtClient({ minIntervalMs: sec * 1000 || CRAWL_INTERVAL_MS, signal });
}

/** 讀取清單（.xlsx 或 .csv；CSV 自動判斷 UTF-8／Big5）。 */
export async function readTable(file: string): Promise<string[][]> {
  if (/\.csv$/i.test(file)) {
    const buf = await fsp.readFile(file);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('big5').decode(buf);
    }
    return parseCsv(text);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  const cols = Math.max(ws.columnCount, 1);
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= cols; c++) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  }
  return rows;
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return isoDay(v);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('');
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
    return '';
  }
  return String(v);
}

async function writeXlsx(file: string, rows: (string | number)[][]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('清單').addRows(rows);
  const buf = await wb.xlsx.writeBuffer();
  await fsp.writeFile(file, Buffer.from(buf));
}

const uniqueIn = (dir: string, name: string): string =>
  path.join(dir, uniqueName(name, (n) => fs.existsSync(path.join(dir, n))));

async function makeDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

async function writeLog(dir: string, name: string, entries: CrawlLogEntry[]): Promise<string> {
  const file = await uniqueIn(dir, name);
  await fsp.writeFile(file, buildCrawlLogCsv(entries), 'utf8');
  return file;
}

/** 匯入階段的重複與格式錯誤，併入擷取紀錄（清單序號 0）。 */
function importLog(duplicates: ListImportIssue[], errors: ListImportIssue[]): CrawlLogEntry[] {
  const out: CrawlLogEntry[] = [];
  for (const d of duplicates) out.push({ index: 0, step: '匯入', title: `第 ${d.row} 列`, url: '', ok: false, reason: d.message });
  for (const e of errors) out.push({ index: 0, step: '匯入', title: `第 ${e.row} 列`, url: '', ok: false, reason: e.message });
  return out;
}

function countOf(logs: CrawlLogEntry[]): { ok: number; failed: number } {
  const ok = logs.filter((l) => l.ok).length;
  return { ok, failed: logs.length - ok };
}

/** 歷審中某一列的裁判書網址：以字號搜尋後比對（歷審列印表沒有連結）。同一字號只搜尋一次。 */
async function resolveHistoryUrl(client: CourtClient, row: HistoryRow, cache: Map<string, JudgmentSummary[]>): Promise<string | null> {
  if (row.pending || !row.caseNo || !row.court) return null;
  const key = row.caseNo.replace(/(判決|裁定)$/, '').trim();
  let items = cache.get(key);
  if (!items) {
    items = await searchJudgments(key, { client, maxItems: 20 });
    cache.set(key, items);
  }
  return matchHistoryRowToItems(row, items).item?.href ?? null;
}

// ───── Step 1 ─────
async function step1(input: string, signal: AbortSignal, progress: ProgressFn, limitPages?: number): Promise<CrawlRunResult> {
  const q = input.trim();
  if (!q) throw new Error('請輸入查詢關鍵字，或貼上司法院查詢結果網址');
  const client = await newClient(signal);
  const isUrl = /qryresultlst\.aspx/.test(q);
  const listUrl = isUrl ? absUrl(q) : `${BASE}qryresultlst.aspx?ty=JUDBOOK&q=${await client.postKeyword(q)}`;

  const firstHtml = await client.request(listPageUrl(listUrl, 1));
  const total = parseTotalCount(firstHtml.replace(/<[^>]+>/g, ' ')) ?? 0;
  if (total <= 0) throw new Error('查無結果（或頁面沒有「共 N 筆」資訊）');
  const plan = planListPages(total);

  const found: JudgmentSummary[] = [];
  const seen = new Set<string>();
  const pageNumbers = limitPages ? plan.pageNumbers.slice(0, limitPages) : plan.pageNumbers;
  for (const p of pageNumbers) {
    if (signal.aborted) break;
    let html: string;
    try {
      html = p === 1 ? firstHtml : await client.request(listPageUrl(listUrl, p));
    } catch (err) {
      if (isCancelled(err, signal)) break;
      throw err;
    }
    for (const it of parseListHtml(html)) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      found.push(it);
    }
    progress({ step: 1, done: p, total: plan.pages, label: `第 ${p} 頁` });
    if (found.length >= plan.maxItems) break;
  }
  const items = found.slice(0, plan.maxItems);
  if (items.length === 0) throw new Error('沒有取得任何裁判書網址');

  const dir = path.join(exportDir(), '文本擷取', 'result_裁判書網址清單');
  await makeDir(dir);
  const file = await uniqueIn(dir, `${safeFileName(isUrl ? '查詢結果' : q)}.xlsx`);
  await writeXlsx(file, [['Index', 'Title', 'URL'], ...items.map((it, i) => [i + 1, it.title, it.href])]);
  const note = plan.truncated ? `（司法院每次上限 25 頁／500 筆，其餘 ${total - items.length} 筆未取得）` : '';
  const cancelled = signal.aborted ? '（已取消，保存已取得的部分）' : '';
  return { step: 1, outputs: [file], ok: items.length, failed: 0, message: `共 ${total} 筆，取得 ${items.length} 筆${note}${cancelled}` };
}

// ───── Step 2 ─────
async function step2(input: string, signal: AbortSignal, progress: ProgressFn, limitItems?: number): Promise<CrawlRunResult> {
  const dir = path.dirname(input);
  const base = outputBase(input);
  const parsed = parseListImport(await readTable(input));
  const { duplicates, errors } = parsed;
  const items = limitItems ? parsed.items.slice(0, limitItems) : parsed.items;
  if (items.length === 0) throw new Error(errors[0] ? `清單無法讀取：${errors[0].message}` : '清單中沒有可擷取的列');
  const txtDir = await uniqueIn(dir, `${base}_文本`);
  await makeDir(txtDir);
  const client = await newClient(signal);
  const logs = await runItems<CrawlListItem>(items, {
    step: 'Step 2', signal,
    describe: (it) => ({ index: it.index, title: it.title, url: absUrl(it.url) }),
    run: async (it) => {
      const url = absUrl(it.url);
      const d = parseDetailHtml(await client.request(url), it.id, url);
      if (!d.fullText) throw new Error('裁判書全文為空（網站可能改版，或該筆已無法開啟）');
      const name = stepTwoFileName(it.index);
      await fsp.writeFile(path.join(txtDir, name), bom(d.fullText), 'utf8');
      return { file: name };
    },
    onProgress: (done, total) => progress({ step: 2, done, total, label: '擷取全文' }),
  });
  const logFile = await writeLog(dir, `${base}_擷取紀錄.csv`, [...importLog(duplicates, errors), ...logs]);
  const c = countOf(logs);
  return {
    step: 2, outputs: [txtDir, logFile], ...c,
    message: `已擷取 ${c.ok} 筆全文，失敗 ${c.failed} 筆（原因見擷取紀錄）`,
  };
}

// ───── Step 3 ─────
async function step3(input: string, signal: AbortSignal, progress: ProgressFn): Promise<CrawlRunResult> {
  const dir = path.dirname(input);
  const base = outputBase(input);
  const { items, duplicates, errors } = parseListImport(await readTable(input));
  if (items.length === 0) throw new Error(errors[0] ? `清單無法讀取：${errors[0].message}` : '清單中沒有可處理的列');
  const client = await newClient(signal);
  const cache = new Map<string, JudgmentSummary[]>();
  const entries: HistoryTableEntry[] = [];
  const logs = await runItems<CrawlListItem>(items, {
    step: 'Step 3', signal,
    describe: (it) => ({ index: it.index, title: it.title, url: absUrl(it.url) }),
    run: async (it) => {
      const url = absUrl(it.url);
      const detail = await getJudgmentDetail(it.id, client);
      if (detail.historyPosition?.status === 'error') throw new Error(detail.historyPosition.summary);
      const rows = detail.history;
      const selfIndex = detail.historyPosition?.index ?? null;
      const urls: string[] = [];
      const missing: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (i === selfIndex) { urls.push(url); continue; }
        const found = await resolveHistoryUrl(client, rows[i], cache);
        urls.push(found ?? '');
        if (!found && !rows[i].pending) missing.push(`第 ${i + 1} 審（${rows[i].court} ${rows[i].caseNo}）無法對應網址`);
      }
      entries.push({ index: it.index, title: it.title || detail.meta.title, historyRows: rows, selfIndex, urls: rows.length ? urls : [url] });
      return missing.length ? { warning: missing.join('；') } : undefined;
    },
    onProgress: (done, total) => progress({ step: 3, done, total, label: '歷審清單' }),
  });
  entries.sort((a, b) => a.index - b.index);
  const file = await uniqueIn(dir, `${base}_歷審.xlsx`);
  await writeXlsx(file, buildHistoryTable(entries));
  const logFile = await writeLog(dir, `${base}_歷審_擷取紀錄.csv`, [...importLog(duplicates, errors), ...logs]);
  const c = countOf(logs);
  return { step: 3, outputs: [file, logFile], ...c, message: `已產生歷審清單：成功 ${c.ok} 筆，失敗 ${c.failed} 筆` };
}

// ───── Step 4 ─────
async function step4(input: string, signal: AbortSignal, progress: ProgressFn): Promise<CrawlRunResult> {
  const dir = path.dirname(input);
  const base = outputBase(input, { stripHistorySuffix: true });
  const table = await readTable(input);
  const header = (table[0] ?? []).map((c) => c.trim());
  if (!isHistoryHeader(header)) throw new Error('請選擇 Step 3 產生的「…_歷審.xlsx」');
  const col = (name: string) => header.indexOf(name);
  const cIdx = col('清單序號');
  const cSeq = col('歷審');
  const cUrl = col('網址');
  const cCourt = col('法院');
  const cCase = col('案號');
  const rowsIn: { index: number; seq: number; url: string; title: string; id: string }[] = [];
  const issues: ListImportIssue[] = [];
  table.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return;
    const lineNo = i + 2;
    const index = Number(cells[cIdx]);
    const seq = historySeqOf(cells[cSeq] ?? '');
    if (!Number.isInteger(index) || index <= 0 || !seq) { issues.push({ row: lineNo, message: '清單序號或歷審序號格式錯誤' }); return; }
    const url = (cells[cUrl] ?? '').trim();
    rowsIn.push({ index, seq, url: url ? absUrl(url) : '', id: url ? idOf(url) : '', title: `${cells[cCourt] ?? ''} ${cells[cCase] ?? ''}`.trim() });
  });
  const txtDir = await uniqueIn(dir, `${base}_歷審_文本`);
  await makeDir(txtDir);
  const client = await newClient(signal);
  const logs = await runItems(rowsIn, {
    step: 'Step 4', signal,
    describe: (r) => ({ index: r.index, title: `${r.title}（歷審_${r.seq}）`, url: r.url }),
    run: async (r) => {
      if (!r.url || !r.id) throw new Error('沒有裁判書網址（繫屬中，或歷審列無法對應）');
      const d = parseDetailHtml(await client.request(r.url), r.id, r.url);
      if (!d.fullText) throw new Error('裁判書全文為空');
      const name = stepFourFileName(r.index, r.seq);
      await fsp.writeFile(path.join(txtDir, name), bom(d.fullText), 'utf8');
      return { file: name };
    },
    onProgress: (done, total) => progress({ step: 4, done, total, label: '歷審文本' }),
  });
  const logFile = await writeLog(dir, `${base}_歷審文本_擷取紀錄.csv`, [...importLog([], issues), ...logs]);
  const c = countOf(logs);
  return { step: 4, outputs: [txtDir, logFile], ...c, message: `已擷取 ${c.ok} 份歷審文本，失敗 ${c.failed} 份` };
}

// ───── Step 5 ─────
const AGG_LABEL = { set: '已定應執行刑', not_set: '未定應執行刑（另查「聲」字裁定）', not_applicable: '' } as const;

async function step5(input: string, appealDays: number | undefined, signal: AbortSignal, progress: ProgressFn): Promise<CrawlRunResult> {
  const dir = path.dirname(input);
  const base = outputBase(input, { stripHistorySuffix: true });
  const table = await readTable(input);
  const header = (table[0] ?? []).map((c) => c.trim());

  // 目標：清單（Step 1、參考平台下載、匯入）或歷審清單中的本案列（備註為「本案」或「自身（無歷審）」）。
  let targets: CrawlListItem[];
  let pre: CrawlLogEntry[] = [];
  if (isHistoryHeader(header)) {
    const cIdx = header.indexOf('清單序號');
    const cUrl = header.indexOf('網址');
    const cNote = header.indexOf('備註');
    const seen = new Set<number>();
    targets = [];
    table.slice(1).forEach((cells) => {
      const note = (cells[cNote] ?? '').trim();
      const index = Number(cells[cIdx]);
      if (!(note === '本案' || note.startsWith('自身'))) return;
      const url = (cells[cUrl] ?? '').trim();
      if (!url || !Number.isInteger(index) || seen.has(index)) return;
      seen.add(index);
      targets.push({ index, title: '', url: absUrl(url), id: idOf(url) });
    });
  } else {
    const imported = parseListImport(table);
    targets = imported.items;
    pre = importLog(imported.duplicates, imported.errors);
  }
  if (targets.length === 0) throw new Error('清單中沒有可判斷的判決');

  const txtDir = await uniqueIn(dir, `${base}_確定判決_文本`);
  await makeDir(txtDir);
  const client = await newClient(signal);
  const cache = new Map<string, JudgmentSummary[]>();
  const today = isoDay(new Date());
  const out: (string | number)[][] = [[
    '清單序號', '字號', '被告', '判決結果', '依據', '最後審法院', '最後審字號', '最後審裁判日期', '定應執行刑', '定應執行刑說明', '網址',
  ]];

  const logs = await runItems(targets, {
    step: 'Step 5', signal,
    describe: (t) => ({ index: t.index, title: t.title || t.url, url: t.url }),
    run: async (t) => {
      const d = await getJudgmentDetail(t.id, client);
      if (d.historyPosition?.status === 'error') throw new Error(d.historyPosition.summary);
      const selfIndex = d.historyPosition?.index ?? null;
      const history: FinalityHistoryItem[] = [];
      for (let i = 0; i < d.history.length; i++) {
        const row = d.history[i];
        let text: string | null = null;
        if (i === selfIndex) text = d.fullText;
        else if (selfIndex !== null && i > selfIndex) {
          // 只需要本件之後各審級的全文（判斷上訴鏈）。
          const u = await resolveHistoryUrl(client, row, cache);
          if (u) text = parseDetailHtml(await client.request(u), idOf(u), u).fullText || null;
        }
        history.push({ row, fullText: text });
      }
      const defendants = extractDefendants(d.fullText);
      if (defendants.length === 0) throw new Error('無法從判決開頭抽出被告姓名');
      await fsp.writeFile(path.join(txtDir, `${t.index}.txt`), bom(d.fullText), 'utf8');
      for (const def of defendants) {
        const r = judgeFinality({
          target: { title: d.meta.title, dateIso: d.meta.dateIso, fullText: d.fullText },
          defendant: def, history, today, appealDays,
        });
        out.push([
          t.index, d.meta.title, def, FINALITY_LABEL[r.outcome], r.basis,
          r.finalJudgment?.court ?? '', r.finalJudgment?.caseNo ?? '', r.finalJudgment?.dateIso ?? '',
          AGG_LABEL[r.aggregate.status], r.aggregate.note, t.url,
        ]);
      }
      return { file: `${t.index}.txt` };
    },
    onProgress: (done, total) => progress({ step: 5, done, total, label: '確定判決' }),
  });

  const xlsx = await uniqueIn(dir, `${base}_確定判決.xlsx`);
  await writeXlsx(xlsx, out);
  const logFile = await writeLog(dir, `${base}_確定判決_擷取紀錄.csv`, [...pre, ...logs]);
  const c = countOf(logs);
  return {
    step: 5, outputs: [xlsx, txtDir, logFile], ...c,
    message: `已判斷 ${out.length - 1} 位被告（${c.ok} 案成功，${c.failed} 案失敗）`,
  };
}

/** 執行一步。取消後回傳已完成的部分（已寫出的檔案與紀錄不會被刪除）。 */
export async function runCrawlStep(args: CrawlRunArgs, signal: AbortSignal, progress: ProgressFn): Promise<CrawlRunResult> {
  try {
    switch (args.step) {
      case 1: return await step1(args.input, signal, progress, args.limitPages);
      case 2: return await step2(args.input, signal, progress, args.limitItems);
      case 3: return await step3(args.input, signal, progress);
      case 4: return await step4(args.input, signal, progress);
      case 5: return await step5(args.input, args.appealDays, signal, progress);
      default: throw new Error('未知的步驟');
    }
  } catch (err) {
    if (signal.aborted && isCancelled(err, signal)) {
      return { step: args.step, outputs: [], ok: 0, failed: 0, message: '已取消' };
    }
    throw new Error(reasonOf(err));
  }
}
