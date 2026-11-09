// 逐項容錯（issue #4 第 1 點：不合不是全棄）。單一項目失敗只記錄，其餘項目照常處理。
// v3.6.0：支援取消（已完成的結果保留）；進度回報例外不影響流程。
import { isCancelled } from './cancel';

export interface SettleFailure<T> {
  item: T;
  message: string;
}

export interface SettleResult<T, R> {
  results: R[];
  failures: SettleFailure<T>[];
  /** 使用者取消時為 true；results 只含取消前已完成的項目。 */
  cancelled: boolean;
}

export async function settleEach<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<SettleResult<T, R>> {
  const results: R[] = [];
  const failures: SettleFailure<T>[] = [];
  let cancelled = false;
  for (let i = 0; i < items.length; i++) {
    if (isCancelled(signal)) { cancelled = true; break; }
    try {
      results.push(await fn(items[i], i));
    } catch (err) {
      if (isCancelled(signal)) { cancelled = true; break; }
      failures.push({ item: items[i], message: err instanceof Error ? err.message : String(err) });
    }
    try { onProgress?.(i + 1, items.length); } catch { /* 進度顯示失敗不影響處理 */ }
  }
  return { results, failures, cancelled };
}
