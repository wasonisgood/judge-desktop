// 登入服務（全程式的閘門）：OAuth 2.1 公開客戶端 + PKCE + 本機回呼（127.0.0.1）。
// 流程：開啟瀏覽器到授權頁 → 使用者登入（已登入則由授權頁直接放行）→ 授權頁導回本機回呼 → 換取 token → 加密保存。
// 開發版可設定 JUDGE_SKIP_AUTH=1 略過（打包後的正式版一律不允許略過）。
import { createServer, type Server, type ServerResponse } from 'node:http';
import { shell } from 'electron';
import {
  createPkce, createState, buildAuthorizeUrl, parseCallbackParams, isAccessValid,
} from '@judge/core';
import {
  AUTH_BASE, LOOPBACK_PORT, REDIRECT_URI, registerClient, exchangeCode, refreshTokens, checkSession, AuthHttpError, type TokenSet,
} from '../data/cloud/authRepo';
import {
  readClientId, writeClientId, readSession, writeSession, clearSession, type AuthSession,
} from '../data/local/authStore';
import { isDev } from '../data/local/paths';

export interface AuthState {
  signedIn: boolean;
  /** 毫秒時間戳；未登入或略過時為 null。 */
  expiresAt: number | null;
  /** 給畫面的說明（例如過期原因）。 */
  message: string | null;
}

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const SIGNED_OUT = (message: string | null): AuthState => ({ signedIn: false, expiresAt: null, message });

let active: { server: Server; cancel: (reason: string) => void } | null = null;

const bypassed = () => isDev && process.env.JUDGE_SKIP_AUTH === '1';

function toSession(t: TokenSet, previousRefresh: string | null): AuthSession {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
}

/**
 * 目前登入狀態。權威判斷在伺服器：每次檢查都向 /oauth/session 確認權杖仍有效（撤銷、過期都會在此生效）。
 * 本機只保存權杖；伺服器無法連線時閘門保持關閉，不以本機記錄放行。
 */
export async function authStatus(): Promise<AuthState> {
  if (bypassed()) return { signedIn: true, expiresAt: null, message: '開發模式：已略過登入' };
  let s = await readSession();
  if (!s) return SIGNED_OUT(null);

  if (!isAccessValid(s.expiresAt)) {
    if (!s.refreshToken) {
      await clearSession();
      return SIGNED_OUT('登入已過期，請重新登入。');
    }
    const clientId = await readClientId();
    if (!clientId) {
      await clearSession();
      return SIGNED_OUT('登入資料不完整，請重新登入。');
    }
    try {
      s = toSession(await refreshTokens(s.refreshToken, clientId), s.refreshToken);
      await writeSession(s);
    } catch (err) {
      if (err instanceof AuthHttpError) {
        await clearSession();
        return SIGNED_OUT('登入已過期，請重新登入。');
      }
      return SIGNED_OUT('無法向伺服器確認登入狀態，請檢查網路後重試。');
    }
  }

  try {
    const info = await checkSession(s.accessToken);
    return { signedIn: true, expiresAt: info.expiresAt ?? s.expiresAt, message: null };
  } catch (err) {
    if (err instanceof AuthHttpError && err.status === 401) {
      await clearSession();
      return SIGNED_OUT('登入已失效，請重新登入。');
    }
    return SIGNED_OUT('無法向伺服器確認登入狀態，請檢查網路後重試。');
  }
}

/**
 * 取得可用的存取權杖（給雲端同步使用）。沒有工作階段或無法更新時回傳 null，不拋錯。
 * 與 authStatus 不同：這裡不做伺服器確認，只在權杖過期時以 refresh_token 更新。
 */
export async function currentAccessToken(): Promise<string | null> {
  if (bypassed()) return null;
  let s = await readSession();
  if (!s) return null;
  if (!isAccessValid(s.expiresAt)) {
    if (!s.refreshToken) return null;
    const clientId = await readClientId();
    if (!clientId) return null;
    try {
      s = toSession(await refreshTokens(s.refreshToken, clientId), s.refreshToken);
      await writeSession(s);
    } catch (err) {
      if (err instanceof AuthHttpError) await clearSession();
      return null;
    }
  }
  return s.accessToken;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

function respondPage(res: ServerResponse, ok: boolean, message: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>司法院裁判研究</title></head>` +
    `<body style="font-family:'Microsoft JhengHei',system-ui,sans-serif;padding:32px;color:#1d1b17">` +
    `<h1 style="font-size:20px">${ok ? '登入完成' : '登入未完成'}</h1>` +
    `<p>${escapeHtml(message)}</p></body></html>`);
}

/** 等待本機回呼：驗證 state、取得授權碼。逾時、取消或埠被占用都會拒絕。 */
function waitForCode(clientId: string, challenge: string, state: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      server.close();
      active = null;
    };
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${LOOPBACK_PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const r = parseCallbackParams(u.searchParams, state);
      respondPage(res, r.ok, r.ok ? '可以關閉此頁，並回到應用程式。' : r.message);
      finish();
      if (r.ok) resolve(r.code);
      else reject(new Error(r.message));
    });
    server.once('error', (e: NodeJS.ErrnoException) => {
      active = null;
      reject(new Error(e.code === 'EADDRINUSE'
        ? `登入需要本機連接埠 ${LOOPBACK_PORT}，請關閉占用該埠的程式後再試。`
        : `無法開啟本機回呼：${e.message}`));
    });
    server.listen(LOOPBACK_PORT, '127.0.0.1', () => {
      timer = setTimeout(() => { finish(); reject(new Error('登入逾時（5 分鐘），請重新登入。')); }, LOGIN_TIMEOUT_MS);
      active = { server, cancel: (reason) => { finish(); reject(new Error(reason)); } };
      void shell.openExternal(buildAuthorizeUrl({ authBase: AUTH_BASE, clientId, redirectUri: REDIRECT_URI, challenge, state }));
    });
  });
}

/** 開始登入：開啟瀏覽器，等待回呼，換取並加密保存權杖。 */
export async function startLogin(): Promise<AuthState> {
  if (bypassed()) return authStatus();
  if (active) return SIGNED_OUT('登入已在進行中，請在瀏覽器完成登入。');
  let clientId = await readClientId();
  if (!clientId) {
    clientId = await registerClient();
    await writeClientId(clientId);
  }
  const { verifier, challenge } = createPkce();
  const state = createState();
  const code = await waitForCode(clientId, challenge, state);
  const session = toSession(await exchangeCode(code, verifier, clientId), null);
  await writeSession(session);
  return { signedIn: true, expiresAt: session.expiresAt, message: null };
}

/** 取消進行中的登入（關閉回呼、拒絕等待中的登入）。 */
export async function cancelLogin(): Promise<AuthState> {
  active?.cancel('已取消登入。');
  return SIGNED_OUT('已取消登入。');
}

/** 登出：刪除本機工作階段（不撤銷伺服器端授權，以免影響其他裝置）。 */
export async function signOut(): Promise<AuthState> {
  await clearSession();
  return SIGNED_OUT(null);
}
