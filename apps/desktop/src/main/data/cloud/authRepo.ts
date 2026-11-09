// 雲端資料層（登入）：與 judge-remote-mcp 的 OAuth 授權伺服器通訊。
// 桌面端是「公開客戶端」：沒有 client secret，改以 PKCE（S256）保護授權碼。回呼使用本機 127.0.0.1（RFC 8252）。
import { buildTokenForm, buildRefreshForm } from '@judge/core';

/** 授權伺服器網址；可用環境變數覆寫（測試用）。 */
export const AUTH_BASE = process.env.JUDGE_AUTH_BASE || 'https://judge-remote-mcp-2026.web.app';
/** 本機回呼埠固定：授權伺服器要求 redirect_uri 完全相符，因此不能隨機選埠。 */
export const LOOPBACK_PORT = 53682;
export const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;
const CLIENT_NAME = '司法院裁判研究';

export interface TokenSet {
  access_token: string;
  token_type?: string;
  /** 秒。 */
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** 授權伺服器回傳的錯誤（含 HTTP 狀態，供判斷是否為 invalid_grant）。 */
export class AuthHttpError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
  }
}

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

function failure(res: Response, json: any, what: string): AuthHttpError {
  const code = typeof json?.error === 'string' ? json.error : null;
  const detail = json?.error_description || json?.message || code || String(res.status);
  return new AuthHttpError(`${what}（${detail}）`, res.status, code);
}

/** 動態註冊桌面端用戶端（RFC 7591）。只需要在第一次登入時做一次。 */
export async function registerClient(): Promise<string> {
  const res = await fetch(new URL('/oauth/register', AUTH_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await readJson(res);
  if (!res.ok || typeof json.client_id !== 'string') throw failure(res, json, '無法註冊登入用戶端');
  return json.client_id;
}

/** 以授權碼與 code_verifier 換取 token。 */
export async function exchangeCode(code: string, verifier: string, clientId: string): Promise<TokenSet> {
  const res = await fetch(new URL('/oauth/token', AUTH_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: buildTokenForm({ code, redirectUri: REDIRECT_URI, clientId, verifier }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await readJson(res);
  if (!res.ok || typeof json.access_token !== 'string') throw failure(res, json, '換取登入憑證失敗');
  return json as TokenSet;
}

/** 以 refresh_token 更新 token。 */
export async function refreshTokens(refreshToken: string, clientId: string): Promise<TokenSet> {
  const res = await fetch(new URL('/oauth/token', AUTH_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: buildRefreshForm({ refreshToken, clientId }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await readJson(res);
  if (!res.ok || typeof json.access_token !== 'string') throw failure(res, json, '更新登入憑證失敗');
  return json as TokenSet;
}
