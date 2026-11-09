// 本地資料層（登入）：用戶端識別碼（非機密，明文）與登入工作階段（以 safeStorage 加密）。
import * as fs from 'node:fs/promises';
import { userPath } from './paths';
import { encryptKey, decryptKey } from './settingsStore';

export interface AuthSession {
  accessToken: string;
  refreshToken: string | null;
  /** 毫秒時間戳。 */
  expiresAt: number;
}

const clientFile = () => userPath('auth-client.json');
const sessionFile = () => userPath('auth-session.json');

export async function readClientId(): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(clientFile(), 'utf8'));
    return typeof j.clientId === 'string' && j.clientId ? j.clientId : null;
  } catch {
    return null;
  }
}

export async function writeClientId(clientId: string): Promise<void> {
  await fs.writeFile(clientFile(), JSON.stringify({ clientId }, null, 2), 'utf8');
}

/** 讀取工作階段；檔案損毀或無法解密時回傳 null（視為未登入）。 */
export async function readSession(): Promise<AuthSession | null> {
  try {
    const { enc } = JSON.parse(await fs.readFile(sessionFile(), 'utf8'));
    const plain = decryptKey(enc);
    if (!plain) return null;
    const s = JSON.parse(plain);
    return typeof s.accessToken === 'string' && typeof s.expiresAt === 'number' ? s : null;
  } catch {
    return null;
  }
}

/** 寫入工作階段；無法加密時拋錯，不會以明文保存權杖。 */
export async function writeSession(s: AuthSession): Promise<void> {
  const enc = encryptKey(JSON.stringify(s));
  await fs.writeFile(sessionFile(), JSON.stringify({ enc }), 'utf8');
}

export async function clearSession(): Promise<void> {
  await fs.rm(sessionFile(), { force: true });
}
