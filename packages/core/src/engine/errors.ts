// 錯誤分類：把各種底層錯誤轉成固定代碼，讓修復精靈知道該提供哪種修復動作。
// 代碼與說明為固定清單；新增代碼時要同步更新 repair.ts 與測試。

export const ENGINE_ERROR_CODES = [
  'DISK_FULL',
  'PERMISSION',
  'NETWORK',
  'TIMEOUT',
  'SERVICE_DOWN',
  'INSTALLER_FAILED',
  'SIGNATURE_INVALID',
  'HASH_MISMATCH',
  'PULL_FAILED',
  'UNKNOWN',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export interface ClassifiedError {
  code: EngineErrorCode;
  retryable: boolean;
  message: string;
}

/** 依錯誤的 code 欄位（Node 系統錯誤）與訊息文字分類。 */
export function classifyError(err: unknown): ClassifiedError {
  const e = err as { code?: string; name?: string; message?: string; cause?: { code?: string } } | undefined;
  const msg = String(e?.message ?? err ?? '');
  const code = e?.code ?? e?.cause?.code ?? '';
  const pick = (c: EngineErrorCode, retryable: boolean): ClassifiedError => ({ code: c, retryable, message: msg.slice(0, 200) });

  if (code === 'ENOSPC' || /no space left|磁碟空間不足|disk full/i.test(msg)) return pick('DISK_FULL', false);
  if (code === 'EACCES' || code === 'EPERM' || /access is denied|permission denied|拒絕存取/i.test(msg)) return pick('PERMISSION', false);
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || code === 'ETIMEDOUT' || /逾時|timed out|timeout/i.test(msg)) return pick('TIMEOUT', true);
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'].includes(code) || /fetch failed|network|網路/i.test(msg)) {
    return pick(code === 'ECONNREFUSED' ? 'SERVICE_DOWN' : 'NETWORK', true);
  }
  if (/簽章|signature/i.test(msg)) return pick('SIGNATURE_INVALID', false);
  if (/雜湊|hash/i.test(msg)) return pick('HASH_MISMATCH', true);
  if (/安裝程式|installer/i.test(msg)) return pick('INSTALLER_FAILED', true);
  if (/服務.*(沒有回應|未回應)|SERVICE/i.test(msg)) return pick('SERVICE_DOWN', true);
  if (/拉取模型|pull/i.test(msg)) return pick('PULL_FAILED', true);
  return pick('UNKNOWN', false);
}
