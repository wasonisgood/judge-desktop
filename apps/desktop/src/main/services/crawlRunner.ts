// 文本擷取的批次執行（純函式，不依賴 Electron，可直接以 node 測試）。
// 單筆失敗不中斷整批：原因寫入擷取紀錄；取消後停止，已完成的部分照常保存。
import type { CrawlLogEntry } from '@judge/core';

/** 每次連線之間的間隔（司法院要求；由 CourtClient 的節流實際執行）。 */
export const CRAWL_INTERVAL_MS = 3000;

export interface ItemDescriptor {
  index: number;
  title: string;
  url: string;
}

export interface ItemOutcome {
  /** 寫入的檔名（相對於輸出資料夾）。 */
  file?: string;
  /** 成功但需要提醒的事項（例如某一審級無法對應網址）；記在擷取紀錄的「原因」欄，結果仍為成功。 */
  warning?: string;
}

const CANCEL_MESSAGE = '已取消';

/** 取消造成的錯誤（取消訊號已觸發，或 CourtClient 回報已取消）。 */
export function isCancelled(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.message === CANCEL_MESSAGE)) return true;
  return false;
}

/** 把錯誤轉成擷取紀錄的原因文字。 */
export function reasonOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err || '未知錯誤');
}

export interface RunItemsOptions<T> {
  step: string;
  signal: AbortSignal;
  describe: (item: T) => ItemDescriptor;
  run: (item: T) => Promise<ItemOutcome | void>;
  onProgress?: (done: number, total: number) => void;
}

/**
 * 依序處理每一筆，回傳擷取紀錄。
 * - 單筆失敗：記錄原因，繼續下一筆。
 * - 取消：不再處理後續各筆，回傳取消前的紀錄。
 */
export async function runItems<T>(items: T[], opts: RunItemsOptions<T>): Promise<CrawlLogEntry[]> {
  const log: CrawlLogEntry[] = [];
  let done = 0;
  for (const item of items) {
    if (opts.signal.aborted) break;
    const d = opts.describe(item);
    try {
      const out = await opts.run(item);
      log.push({
        index: d.index,
        step: opts.step,
        title: d.title,
        url: d.url,
        ok: true,
        file: out?.file,
        reason: out?.warning,
      });
    } catch (err) {
      if (isCancelled(err, opts.signal)) break;
      log.push({ index: d.index, step: opts.step, title: d.title, url: d.url, ok: false, reason: reasonOf(err) });
    }
    done += 1;
    opts.onProgress?.(done, items.length);
  }
  return log;
}

/** 輸入檔的基底名稱：去掉副檔名；若是歷審清單（…_歷審）則去掉尾端的「_歷審」。 */
export function outputBase(inputPath: string, { stripHistorySuffix = false } = {}): string {
  const name = inputPath.split(/[\\/]/).pop() ?? inputPath;
  let base = name.replace(/\.(xlsx|csv)$/i, '');
  if (stripHistorySuffix) base = base.replace(/_歷審$/, '');
  return base || '清單';
}

/** 表頭是否為歷審清單（Step 3 的輸出）。 */
export function isHistoryHeader(header: string[]): boolean {
  const h = header.map((c) => c.trim());
  return h.includes('歷審') && h.includes('網址') && h.includes('清單序號');
}

/** 歷審序號：「歷審_2」→ 2；無法解析回傳 null。 */
export function historySeqOf(label: string): number | null {
  const m = /_(\d+)$/.exec(label.trim());
  return m ? Number(m[1]) : null;
}
