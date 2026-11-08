// 安裝失敗回報內容：只包含階段、版本、硬體分級與去敏後的錯誤摘要。
// 不包含 API 金鑰、檔案路徑、電子郵件、使用者名稱或判決內容。

export interface FailureReport {
  appVersion: string;
  rulesVersion: number;
  stage: string;
  tier: string;
  /** 錯誤訊息去敏後的摘要（最多 200 字）。 */
  message: string;
  osVersion: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /[A-Za-z]:\\[^\s"']+/g, // Windows 路徑
  /\/Users\/[^\s"']+/g, // macOS／Linux 家目錄路徑
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // 電子郵件
  /Bearer\s+\S+/gi,
];

export function sanitizeMessage(msg: string): string {
  let out = msg;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[已遮蔽]');
  return out.slice(0, 200);
}

export function buildFailureReport(input: Omit<FailureReport, 'message'> & { message: string }): FailureReport {
  return { ...input, message: sanitizeMessage(input.message) };
}
