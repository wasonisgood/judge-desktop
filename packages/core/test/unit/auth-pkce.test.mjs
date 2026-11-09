// 桌面端登入的 PKCE 與回呼解析：RFC 7636 附錄 B 的測試向量、state 不符拒絕、授權網址與換 token 表單。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64url, s256Challenge, createPkce, createState, buildAuthorizeUrl, parseCallbackParams, buildTokenForm, buildRefreshForm, isAccessValid,
} from '../../dist/index.js';

test('PKCE：S256 與 RFC 7636 附錄 B 的測試向量一致', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(s256Challenge(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('PKCE：產生的 verifier 為 43 字元 base64url，且 challenge 與之相符', () => {
  const { verifier, challenge } = createPkce();
  assert.equal(verifier.length, 43);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.equal(challenge, s256Challenge(verifier));
  assert.notEqual(createPkce().verifier, verifier);
});

test('state：16 位元組隨機值，每次不同且只含 base64url 字元', () => {
  const s = createState();
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(createState(), s);
});

test('base64url：不含 + / = 填充', () => {
  assert.equal(base64url(Buffer.from([0xfb, 0xff])), '-_8');
});

test('授權網址：含全部必要參數，且 code_challenge_method 為 S256', () => {
  const url = new URL(buildAuthorizeUrl({
    authBase: 'https://judge-remote-mcp-2026.web.app', clientId: 'jmc_abc', redirectUri: 'http://127.0.0.1:53682/callback', challenge: 'CH', state: 'ST',
  }));
  assert.equal(url.origin + url.pathname, 'https://judge-remote-mcp-2026.web.app/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'jmc_abc');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:53682/callback');
  assert.equal(url.searchParams.get('code_challenge'), 'CH');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'ST');
});

test('回呼：state 正確且有授權碼 → 成功', () => {
  const r = parseCallbackParams(new URLSearchParams('code=CODE1&state=S1'), 'S1');
  assert.deepEqual(r, { ok: true, code: 'CODE1' });
});

test('回呼：state 不符一律拒絕（防止他人塞入授權碼）', () => {
  const r = parseCallbackParams(new URLSearchParams('code=CODE1&state=EVIL'), 'S1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'state-mismatch');
  const none = parseCallbackParams(new URLSearchParams('code=CODE1'), 'S1');
  assert.equal(none.reason, 'state-mismatch');
});

test('回呼：使用者拒絕（error）與缺少授權碼都會回報原因', () => {
  const denied = parseCallbackParams(new URLSearchParams('error=access_denied&state=S1'), 'S1');
  assert.equal(denied.reason, 'denied');
  const missing = parseCallbackParams(new URLSearchParams('state=S1'), 'S1');
  assert.equal(missing.reason, 'missing-code');
});

test('換 token 表單：authorization_code、code_verifier 與 redirect_uri 都正確送出', () => {
  const body = new URLSearchParams(buildTokenForm({ code: 'C', redirectUri: 'http://127.0.0.1:53682/callback', clientId: 'jmc_abc', verifier: 'V' }));
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'C');
  assert.equal(body.get('code_verifier'), 'V');
  assert.equal(body.get('redirect_uri'), 'http://127.0.0.1:53682/callback');
  assert.equal(body.get('client_id'), 'jmc_abc');
});

test('更新 token 表單：refresh_token 與 client_id', () => {
  const body = new URLSearchParams(buildRefreshForm({ refreshToken: 'R', clientId: 'jmc_abc' }));
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'R');
});

test('token 有效性：提前 60 秒視為過期', () => {
  const now = 1_000_000;
  assert.equal(isAccessValid(now + 120_000, now), true);
  assert.equal(isAccessValid(now + 30_000, now), false);
  assert.equal(isAccessValid(now - 1, now), false);
});
