// 安裝程式的數位簽章驗證結果解析。實際驗證由桌面端以 PowerShell 的 Get-AuthenticodeSignature 執行，
// 這裡只負責把它的輸出（JSON）判讀成「通過／不通過」，並檢查簽署者是否為預期的發行者。

export interface SignatureReport {
  status: string;
  subject: string | null;
}

export function parseSignatureJson(json: string): SignatureReport {
  const j = JSON.parse(json);
  return { status: String(j.Status ?? ''), subject: j.Subject ?? null };
}

/** 只有 Status 為 Valid，且簽署者名稱包含預期的發行者字串時才通過。 */
export function isTrustedSignature(report: SignatureReport, expectedPublisher: string): { ok: boolean; reason: string } {
  if (report.status !== 'Valid') return { ok: false, reason: `簽章狀態為 ${report.status || '未知'}，不是有效簽章` };
  if (!report.subject || !report.subject.toLowerCase().includes(expectedPublisher.toLowerCase())) {
    return { ok: false, reason: `簽署者不是預期的發行者（${expectedPublisher}）` };
  }
  return { ok: true, reason: '簽章有效且發行者相符' };
}
