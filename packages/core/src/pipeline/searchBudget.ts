// 搜尋預算（issue #4 第 1、2 點）：同一輪對話或同一次查詢中，最多搜尋 max 次；
// 已找到的結果一律保留（不合不是全棄）；達上限時不再搜尋，並回報目前保留的結果與狀況。
export interface SearchBudget<T> {
  max: number;
  calls: number;
  tried: string[];
  kept: Map<string, T>;
}

export function createSearchBudget<T>(max: number): SearchBudget<T> {
  return { max: Math.max(1, Math.floor(max)), calls: 0, tried: [], kept: new Map() };
}

export function remainingSearches<T>(b: SearchBudget<T>): number {
  return Math.max(0, b.max - b.calls);
}

export interface BudgetedSearchResult<T> {
  status: 'ok' | 'capped' | 'no_new_query';
  /** 本次實際執行的關鍵字（已去除重複與已嘗試過的）。 */
  ran: string[];
  /** 目前保留的全部結果（跨次累計）。 */
  items: T[];
  remaining: number;
  /** 給模型或畫面看的狀況說明。 */
  message: string;
}

export const MAX_QUERIES_PER_CALL = 4;

export async function runBudgetedSearch<T>(
  b: SearchBudget<T>,
  queries: string[],
  search: (q: string) => Promise<T[]>,
  keyOf: (item: T) => string,
  onError?: (q: string, err: unknown) => void,
): Promise<BudgetedSearchResult<T>> {
  const fresh = [...new Set(queries.map((q) => q.trim()).filter(Boolean))]
    .filter((q) => !b.tried.includes(q))
    .slice(0, MAX_QUERIES_PER_CALL);
  if (b.calls >= b.max) {
    return {
      status: 'capped', ran: [], items: [...b.kept.values()], remaining: 0,
      message: `已達搜尋上限（${b.max} 次）。請依目前保留的 ${b.kept.size} 筆結果回答，說明狀況與解方，並詢問使用者是否同意新方向。`,
    };
  }
  if (fresh.length === 0) {
    return {
      status: 'no_new_query', ran: [], items: [...b.kept.values()], remaining: remainingSearches(b),
      message: '沒有新的關鍵字可以搜尋（都已嘗試過）。請換用不同的字詞。',
    };
  }
  b.calls++;
  const failures: string[] = [];
  for (const q of fresh) {
    b.tried.push(q);
    try {
      for (const it of await search(q)) if (!b.kept.has(keyOf(it))) b.kept.set(keyOf(it), it);
    } catch (err) {
      failures.push(q);
      onError?.(q, err);
    }
  }
  const remaining = remainingSearches(b);
  const parts = [`已搜尋 ${fresh.join('、')}`, `目前保留 ${b.kept.size} 筆`, `剩餘 ${remaining} 次搜尋`];
  if (failures.length) parts.push(`失敗：${failures.join('、')}`);
  if (b.kept.size === 0 && remaining > 0) parts.push('結果不足，可換關鍵字再搜尋');
  if (b.kept.size === 0 && remaining === 0) parts.push('已達搜尋上限，請說明狀況並詢問使用者是否同意新方向');
  return { status: 'ok', ran: fresh, items: [...b.kept.values()], remaining, message: parts.join('；') };
}
