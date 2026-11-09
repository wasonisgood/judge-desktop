// 工作負載身分聯盟的設定檢查（v3.7.0）：本工具是身分提供者（發行者），身分權杖由 judge-remote-mcp 簽發；
// 使用者只需在 Anthropic 後台建立聯盟規則後，把三組代碼與（選填）工作區代碼填入本工具。
// 這裡只做格式檢查與固定值（不連網），畫面與主程序共用同一套規則。

/** 本工具的身分提供者（發行者）網址；與 judge-remote-mcp 的 issuer 必須完全相符。 */
export const FEDERATION_ISSUER = 'https://judge-remote-mcp-2026.web.app';
/** 權杖的受眾（Anthropic API）。 */
export const FEDERATION_AUDIENCE = 'https://api.anthropic.com';
/** 本工具身分權杖的有效秒數（與伺服器一致）。 */
export const FEDERATION_TOKEN_TTL_SECONDS = 600;
/** 本工具簽發的 sub 前綴（與伺服器 wif.ts 一致）。 */
export const FEDERATION_SUBJECT_PATTERN = 'desktop:*';

export type IdentitySource = 'provider' | 'file';

export interface FederationFields {
  organizationId: string;
  federationRuleId: string;
  serviceAccountId: string;
  workspaceId: string;
  identitySource: IdentitySource;
  identityTokenFile: string;
}

export interface FieldProblem {
  field: keyof FederationFields;
  message: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FDRL_RE = /^fdrl_[A-Za-z0-9]+$/;
const SVAC_RE = /^svac_[A-Za-z0-9]+$/;
const WRKSPC_RE = /^wrkspc_[A-Za-z0-9]+$/;

/** 檢查設定是否可以使用。回傳空陣列表示完整且格式正確。 */
export function checkFederationFields(f: FederationFields): FieldProblem[] {
  const out: FieldProblem[] = [];
  const org = f.organizationId.trim();
  const rule = f.federationRuleId.trim();
  const svc = f.serviceAccountId.trim();
  const ws = f.workspaceId.trim();
  if (!org) out.push({ field: 'organizationId', message: '請填入組織 ID（後台的組織設定中）。' });
  else if (!UUID_RE.test(org)) out.push({ field: 'organizationId', message: '組織 ID 應為 UUID 格式（例如 8c5aaae2-1c0c-4f73-94f8-a8b8d4b6a015）。' });
  if (!rule) out.push({ field: 'federationRuleId', message: '請填入聯盟規則 ID（以 fdrl_ 開頭）。' });
  else if (!FDRL_RE.test(rule)) out.push({ field: 'federationRuleId', message: '聯盟規則 ID 應以 fdrl_ 開頭。' });
  if (!svc) out.push({ field: 'serviceAccountId', message: '請填入服務帳戶 ID（以 svac_ 開頭）。' });
  else if (!SVAC_RE.test(svc)) out.push({ field: 'serviceAccountId', message: '服務帳戶 ID 應以 svac_ 開頭。' });
  if (ws && !WRKSPC_RE.test(ws)) out.push({ field: 'workspaceId', message: '工作區 ID 應以 wrkspc_ 開頭（留空表示規則涵蓋的工作區由後台決定）。' });
  if (f.identitySource === 'file' && !f.identityTokenFile.trim()) {
    out.push({ field: 'identityTokenFile', message: '選擇「自備身分憑證檔」時，請填入檔案路徑。' });
  }
  return out;
}

/** 目前可用的權杖來源描述（給說明與畫面用）。 */
export function identitySourceLabel(s: IdentitySource): string {
  return s === 'provider' ? '本工具簽發（推薦）' : '自備身分憑證檔（進階）';
}
