// 「跳至原文」（#22）：在判決全文中定位覆核的依據。定位使用與 AI 依據驗證相同的原文文字（judgmentBodyText），
// 找不到時明確回報，不假裝定位成功。全文取得（快取優先、節流）在 IPC 層做，這裡只處理定位與訊息。
import { judgmentBodyText, judgmentHasBody, locateQuote, type JudgmentDetail } from '@judge/core';
import { toUserError } from './userError';

export const QUOTE_FOUND_TEXT = '已在判決原文中定位此段依據（以底色標示）。';
export const EMPTY_BODY_TEXT = '無法取得判決全文：取得的內容沒有判決原文（判決編號可能不存在或已變更）。';
export const QUOTE_NOT_FOUND_TEXT = '原文中找不到此段，依據可能已失效（判決可能已更正，請以司法院最新版本為準）。';

export type JudgmentQuoteView =
  | { ok: true; title: string; text: string; span: { start: number; end: number } | null; message: string }
  | { ok: false; error: string };

/** 在判決全文中定位依據；找不到時 span 為 null，並說明原因。 */
export function locateJudgmentQuote(d: JudgmentDetail, quote: string): JudgmentQuoteView {
  const text = judgmentBodyText(d);
  // 取得的內容沒有判決原文（例如判決編號不存在）是取得失敗，不是「依據找不到」。
  if (!judgmentHasBody(d)) return { ok: false, error: EMPTY_BODY_TEXT };
  const span = locateQuote(text, quote);
  return {
    ok: true,
    title: d.meta.title,
    text,
    span,
    message: span ? QUOTE_FOUND_TEXT : QUOTE_NOT_FOUND_TEXT,
  };
}

/** 全文取得失敗（網路、快取、判決不存在）時給畫面的說明；不影響覆核結果。 */
export function judgmentFetchError(err: unknown): string {
  return `無法取得判決全文：${toUserError(err).message}`;
}
