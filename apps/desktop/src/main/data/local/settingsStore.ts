// 本地資料層：設定檔（settings.json）。金鑰以 safeStorage 加密後才寫入。
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs/promises';
import { DEFAULT_BRIEF_FIELDS, DEFAULT_JURISDICTION_ID, type BriefField } from '@judge/core';
import { userPath } from './paths';

export interface FederationSettings {
  organizationId: string;
  federationRuleId: string;
  serviceAccountId: string;
  workspaceId: string;
  /** 使用者提供的身分憑證（OIDC JWT）檔案路徑；每次換取時重新讀取（僅 identitySource 為 file 時使用）。 */
  identityTokenFile: string;
  /** 身分權杖來源：provider＝本工具（judge-remote-mcp）簽發（預設）；file＝自備檔案。 */
  identitySource: 'provider' | 'file';
}

export interface StoredSettings {
  aiProvider: 'anthropic' | 'openai-compatible';
  aiAuthMode: 'apiKey' | 'federation';
  aiBaseUrl: string;
  aiModel: string;
  aiKeyEnc: string | null;
  federation: FederationSettings;
  defaultMaxItems: number;
  cacheDays: number;
  /** 精讀欄位設定：enabled 表示是否勾選；自訂欄位也保存在這裡。 */
  briefFields: (BriefField & { enabled: boolean })[];
  /** 本地 AI 模組開關：關閉時即使已安裝，也一律使用雲端。 */
  localAiEnabled: boolean;
  /** 預設管轄區識別碼（見 jurisdictionRegistry）。 */
  defaultJurisdiction: string;
  /** 量化圖表模組：開啟即「安裝並啟用」，關閉即移除（頁面隱藏；不影響其他功能）。 */
  chartModuleEnabled: boolean;
}

export const EMPTY_FEDERATION: FederationSettings = {
  organizationId: '', federationRuleId: '', serviceAccountId: '', workspaceId: '', identityTokenFile: '', identitySource: 'provider',
};

export const DEFAULTS: StoredSettings = {
  aiProvider: 'anthropic',
  aiAuthMode: 'apiKey',
  federation: { ...EMPTY_FEDERATION },
  aiBaseUrl: 'https://api.anthropic.com',
  aiModel: 'claude-haiku-5-5',
  aiKeyEnc: null,
  defaultMaxItems: 20,
  cacheDays: 7,
  briefFields: DEFAULT_BRIEF_FIELDS.map((f) => ({ ...f, enabled: true })),
  localAiEnabled: true,
  defaultJurisdiction: DEFAULT_JURISDICTION_ID,
  chartModuleEnabled: false,
};

export async function readSettings(): Promise<StoredSettings> {
  try {
    return { ...DEFAULTS, ...JSON.parse(await fs.readFile(userPath('settings.json'), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeSettings(s: StoredSettings) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(userPath('settings.json'), JSON.stringify(s, null, 2), 'utf8');
}

export function decryptKey(enc: string | null): string | null {
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(enc, 'base64'));
}

export function encryptKey(key: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('這台電腦無法加密保存金鑰，請改用其他方式。');
  return safeStorage.encryptString(key).toString('base64');
}
