// 錯誤訊息（v3.6.0）：把技術錯誤轉成使用者看得懂的中文說明，並保留原文供除錯。
export interface FriendlyError {
  message: string;
  /** 是否值得重試（逾時、暫時無法連線、請求過於頻繁）。 */
  retryable: boolean;
}

export function friendlyError(err: unknown): FriendlyError {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const e = err as { name?: string; code?: string } | undefined;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || /aborted|timed out|timeout|逾時/i.test(raw)) {
    return { message: '連線逾時，請稍後再試。', retryable: true };
  }
  if (/額度|quota|insufficient[_ ]?(balance|quota)|credit|billing|餘額/i.test(raw)) {
    return { message: 'AI 額度不足或帳務問題，請到 AI 服務商檢查餘額後再試。', retryable: false };
  }
  if (/\b401\b|\b403\b|invalid[_ ]?api[_ ]?key|unauthorized|forbidden|金鑰/i.test(raw)) {
    return { message: 'AI 金鑰無效或權限不足，請到「設定」重新確認金鑰。', retryable: false };
  }
  if (/\b429\b|rate[_ ]?limit|too many requests|請求過於頻繁/i.test(raw)) {
    return { message: 'AI 服務請求過於頻繁，請稍候再試。', retryable: true };
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'ECONNREFUSED' || e?.code === 'ECONNRESET' || /fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(raw)) {
    return { message: '無法連線，請確認網路後再試。', retryable: true };
  }
  return { message: raw || '發生未知錯誤。', retryable: false };
}
