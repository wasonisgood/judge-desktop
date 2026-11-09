// 取消（v3.6.0）：長時間工作以 AbortSignal 表示「使用者要求取消」。
// 取消時不丟失已完成的部分：流程回傳 cancelled 狀態與目前已保留的結果。
export class JobCancelledError extends Error {
  constructor(message = '已取消') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

export function isCancelled(signal?: AbortSignal): boolean {
  return !!signal?.aborted;
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new JobCancelledError();
}

export function isCancelError(err: unknown): boolean {
  return err instanceof JobCancelledError || (err instanceof Error && err.name === 'AbortError');
}

/** 讓一個 Promise 能被取消：訊號觸發時立即以 JobCancelledError 拒絕（底層請求是否中止由呼叫端另行處理）。 */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new JobCancelledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new JobCancelledError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}
