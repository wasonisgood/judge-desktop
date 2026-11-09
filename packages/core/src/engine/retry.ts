// 指數退避重試。只重試被判定為可重試的錯誤；不可重試的錯誤立刻拋出。
import { classifyError } from './errors';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 每次失敗後呼叫（給畫面顯示「第 N 次重試」）。 */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  /** 取消訊號（v3.6.0）：取消後不再重試。 */
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const retryable = classifyError(err).retryable;
      if (!retryable || i === attempts || opts.signal?.aborted) throw err;
      const delay = Math.min(max, base * 2 ** (i - 1));
      opts.onRetry?.(i, delay, err);
      await sleep(delay);
    }
  }
  throw lastErr;
}
