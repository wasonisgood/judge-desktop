// 使用者看得懂的錯誤（v3.6.0）：工作失敗時回給畫面的訊息一律經過這裡；原始錯誤仍記在主程序的主控台。
import { friendlyError } from '@judge/core';

export function toUserError(err: unknown): Error {
  const f = friendlyError(err);
  if (err instanceof Error && err.stack) console.error('[工作錯誤]', err.stack);
  return new Error(f.message);
}
