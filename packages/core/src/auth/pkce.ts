// 桌面端登入的 OAuth 2.1 公開客戶端工具（RFC 7636 PKCE、RFC 8252 本機回呼）。純函式，不做網路或檔案 I/O。
// 授權伺服器：judge-remote-mcp（/oauth/register、/oauth/authorize、/oauth/token；token_endpoint_auth_method = none）。
import { createHash, randomBytes } from 'node:crypto';

/** 把位元組轉為 base64url（無填充），符合 RFC 7636 的字元集。 */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkcePair {
  /** 程式端保管的隨機字串（43–128 字元）；只在換取 token 時送出。 */
  verifier: string;
  /** 由 verifier 以 S256 計算，放在授權網址上。 */
  challenge: string;
}

/** 以 S256 計算 challenge（RFC 7636 §4.2）。 */
export function s256Challenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'ascii').digest());
}

/** 產生 PKCE 組合。verifier 取 32 位元組隨機值（base64url 後 43 字元）。 */
export function createPkce(random: (n: number) => Buffer = randomBytes): PkcePair {
  const verifier = base64url(random(32));
  return { verifier, challenge: s256Challenge(verifier) };
}

/** 防 CSRF 的 state（16 位元組隨機值）。 */
export function createState(random: (n: number) => Buffer = randomBytes): string {
  return base64url(random(16));
}

export interface AuthorizeParams {
  authBase: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}

/** 組出授權頁網址（使用者在瀏覽器中開啟）。 */
export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const u = new URL('/oauth/authorize', p.authBase);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', p.state);
  return u.toString();
}

export type CallbackResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'state-mismatch' | 'denied' | 'missing-code'; message: string };

/**
 * 解析本機回呼的查詢參數。state 不符一律拒絕（防止他人把自己的授權碼塞進來）。
 * error 參數代表使用者拒絕或伺服器錯誤。
 */
export function parseCallbackParams(params: URLSearchParams, expectedState: string): CallbackResult {
  const state = params.get('state') ?? '';
  if (state !== expectedState) return { ok: false, reason: 'state-mismatch', message: '回呼的 state 不一致，已拒絕。' };
  const error = params.get('error');
  if (error) return { ok: false, reason: 'denied', message: params.get('error_description') || `授權未完成（${error}）` };
  const code = params.get('code') ?? '';
  if (!code) return { ok: false, reason: 'missing-code', message: '回呼缺少授權碼。' };
  return { ok: true, code };
}

/** 換取 token 的表單內容（application/x-www-form-urlencoded）。 */
export function buildTokenForm(p: { code: string; redirectUri: string; clientId: string; verifier: string }): string {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.verifier,
  }).toString();
}

/** 更新 token 的表單內容。 */
export function buildRefreshForm(p: { refreshToken: string; clientId: string }): string {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId,
  }).toString();
}

/** token 是否仍有效（提前 60 秒視為過期，避免剛好在請求途中失效）。 */
export function isAccessValid(expiresAtMs: number, nowMs: number = Date.now()): boolean {
  return expiresAtMs - nowMs > 60_000;
}
