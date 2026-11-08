// 工作負載身分聯合的單元測試（假的 fetch 與假的時鐘）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exchangeFederatedToken, FederatedTokenProvider, WIF_GRANT_TYPE } from '../../dist/index.js';

const cfg = { baseUrl: 'https://api.anthropic.com/', organizationId: 'org-1', federationRuleId: 'fdrl_1', serviceAccountId: 'svac_1' };

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return handler(calls.length);
  };
  f.calls = calls;
  return f;
}
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

test('換取權杖：請求為 jwt-bearer，欄位齊全，網址正確', async () => {
  const f = fakeFetch(() => ok({ access_token: 'sk-ant-oat01-abc', token_type: 'Bearer', expires_in: 600 }));
  const t = await exchangeFederatedToken(cfg, 'JWT.X.Y', { fetchImpl: f, now: () => 1000 });
  assert.equal(f.calls[0].url, 'https://api.anthropic.com/v1/oauth/token');
  assert.equal(f.calls[0].body.grant_type, WIF_GRANT_TYPE);
  assert.equal(f.calls[0].body.assertion, 'JWT.X.Y');
  assert.equal(f.calls[0].body.federation_rule_id, 'fdrl_1');
  assert.equal(f.calls[0].body.organization_id, 'org-1');
  assert.equal(f.calls[0].body.service_account_id, 'svac_1');
  assert.equal(f.calls[0].body.workspace_id, undefined, '未設定工作區時不送出該欄位');
  assert.equal(t.accessToken, 'sk-ant-oat01-abc');
  assert.equal(t.expiresAt, 1000 + 600_000);
});

test('多工作區時送出 workspace_id', async () => {
  const f = fakeFetch(() => ok({ access_token: 'x', expires_in: 60 }));
  await exchangeFederatedToken({ ...cfg, workspaceId: 'wrkspc_9' }, 'J', { fetchImpl: f });
  assert.equal(f.calls[0].body.workspace_id, 'wrkspc_9');
});

test('失敗時錯誤訊息帶上狀態碼與伺服器說明', async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'issuer mismatch' }), { status: 401 }));
  await assert.rejects(exchangeFederatedToken(cfg, 'J', { fetchImpl: f }), /HTTP 401.*issuer mismatch/);
});

test('回應沒有 access_token 時明確報錯', async () => {
  const f = fakeFetch(() => ok({ token_type: 'Bearer' }));
  await assert.rejects(exchangeFederatedToken(cfg, 'J', { fetchImpl: f }), /沒有 access_token/);
});

test('快取：未快到期時重複使用，不重複換取', async () => {
  let clock = 0;
  const f = fakeFetch(() => ok({ access_token: 'tok' + Math.random(), expires_in: 3600 }));
  const p = new FederatedTokenProvider(cfg, async () => 'J', { fetchImpl: f, now: () => clock });
  const a = await p.get();
  clock = 60_000;
  const b = await p.get();
  assert.equal(a, b);
  assert.equal(f.calls.length, 1);
});

test('刷新：距到期不足 120 秒時重新換取', async () => {
  let clock = 0;
  let n = 0;
  const f = fakeFetch(() => ok({ access_token: 'tok' + (++n), expires_in: 300 }));
  const p = new FederatedTokenProvider(cfg, async () => 'J', { fetchImpl: f, now: () => clock });
  assert.equal(await p.get(), 'tok1');
  clock = 200_000; // 剩餘 100 秒，小於 120 秒
  assert.equal(p.needsRefresh(), true);
  assert.equal(await p.get(), 'tok2');
  assert.equal(f.calls.length, 2);
});

test('同時多個呼叫只會換取一次', async () => {
  let n = 0;
  const f = fakeFetch(async () => { await new Promise((r) => setTimeout(r, 20)); return ok({ access_token: 'tok' + (++n), expires_in: 3600 }); });
  const p = new FederatedTokenProvider(cfg, async () => 'J', { fetchImpl: f, now: () => 0 });
  const [a, b, c] = await Promise.all([p.get(), p.get(), p.get()]);
  assert.equal(f.calls.length, 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('身分憑證每次換取時重新讀取（檔案可能被輪替）', async () => {
  let clock = 0;
  const reads = [];
  const f = fakeFetch(() => ok({ access_token: 't', expires_in: 100 }));
  const p = new FederatedTokenProvider(cfg, async () => { reads.push(1); return 'J' + reads.length; }, { fetchImpl: f, now: () => clock });
  await p.get();
  clock = 90_000;
  await p.get();
  assert.equal(reads.length, 2);
  assert.equal(f.calls[1].body.assertion, 'J2');
});
