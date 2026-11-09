// 逐項容錯（issue #4 第 1 點：不合不是全棄）。單一項目失敗只記錄，其餘項目照常處理。
export interface SettleFailure<T> {
  item: T;
  message: string;
}

export interface SettleResult<T, R> {
  results: R[];
  failures: SettleFailure<T>[];
}

export async function settleEach<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<SettleResult<T, R>> {
  const results: R[] = [];
  const failures: SettleFailure<T>[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      results.push(await fn(items[i], i));
    } catch (err) {
      failures.push({ item: items[i], message: err instanceof Error ? err.message : String(err) });
    }
    onProgress?.(i + 1, items.length);
  }
  return { results, failures };
}
