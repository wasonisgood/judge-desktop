// 本地 AI 分級、網路探測、本地／雲端路由的單元測試（全部使用假資料，不實際連線）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLocalAI, runNetworkProbe, LocalCloudRouter, MODEL_TABLE } from '../../dist/index.js';

const base = { freeDiskGB: 100, vramGB: 0, gpuVendor: 'none' };

test('磁碟不足 10 GB → 只用雲端', () => {
  const p = planLocalAI({ ...base, ramGB: 32, freeDiskGB: 9, vramGB: 12, gpuVendor: 'nvidia' });
  assert.equal(p.tier, 'none');
  assert.equal(p.judgmentModel, null);
  assert.match(p.reasons.join(), /磁碟/);
});

test('記憶體 < 8 GB → 只用雲端', () => {
  assert.equal(planLocalAI({ ...base, ramGB: 4 }).tier, 'none');
});

test('8–15 GB → light，單一模型', () => {
  const p = planLocalAI({ ...base, ramGB: 8 });
  assert.equal(p.tier, 'light');
  assert.equal(p.judgmentModel, MODEL_TABLE.light.judgment);
  assert.equal(p.chatModel, MODEL_TABLE.light.judgment);
  assert.equal(p.installBoth, false);
});

test('16–31 GB → standard，單一模型', () => {
  const p = planLocalAI({ ...base, ramGB: 16 });
  assert.equal(p.tier, 'standard');
  assert.equal(p.installBoth, false);
});

test('32 GB 以上但無獨立顯卡 → heavy 但只裝精讀模型', () => {
  const p = planLocalAI({ ...base, ramGB: 32 });
  assert.equal(p.tier, 'heavy');
  assert.equal(p.installBoth, false);
  assert.equal(p.chatModel, MODEL_TABLE.heavy.judgment);
  assert.match(p.reasons.join(), /顯存/);
});

test('32 GB + 8 GB VRAM 獨立顯卡 → heavy 雙模型（精讀較重、回答較輕）', () => {
  const p = planLocalAI({ freeDiskGB: 100, ramGB: 32, vramGB: 8, gpuVendor: 'nvidia' });
  assert.equal(p.installBoth, true);
  assert.equal(p.judgmentModel, MODEL_TABLE.heavy.judgment);
  assert.equal(p.chatModel, MODEL_TABLE.heavy.chat);
  assert.notEqual(p.judgmentModel, p.chatModel);
  assert.equal(p.requiredDiskGB, MODEL_TABLE.heavy.diskGB + MODEL_TABLE.standard.diskGB);
});

test('雙模型所需磁碟超過可用空間 → 退回雲端並說明', () => {
  const p = planLocalAI({ freeDiskGB: 15, ramGB: 32, vramGB: 8, gpuVendor: 'nvidia' });
  assert.equal(p.tier, 'none');
  assert.match(p.reasons.join(), /不足/);
});

test('runNetworkProbe：全部通過 → ready', async () => {
  const f = async () => ({ status: 200 });
  const s = await runNetworkProbe({ fetchImpl: f, now: () => 0 });
  assert.equal(s.ready, true);
  assert.equal(s.results.every((r) => r.ok), true);
});

test('runNetworkProbe：司法院網域連不上（必要）→ 未就緒並提示 VPN', async () => {
  const f = async (url) => {
    if (String(url).includes('judicial')) throw Object.assign(new Error('x'), { name: 'TypeError' });
    return { status: 204 };
  };
  const s = await runNetworkProbe({ fetchImpl: f, now: () => 0 });
  assert.equal(s.ready, false);
  assert.match(s.messages.join(), /VPN/);
});

test('runNetworkProbe：一般網路失敗（非必要）→ 仍然就緒', async () => {
  const f = async (url) => {
    if (String(url).includes('google')) throw new Error('down');
    return { status: 200 };
  };
  const s = await runNetworkProbe({ fetchImpl: f, now: () => 0 });
  assert.equal(s.ready, true);
});

test('runNetworkProbe：伺服器 5xx 視為失敗，3xx 視為通過', async () => {
  const targets = [{ name: 'a', url: 'https://a/', required: true }];
  const bad = await runNetworkProbe({ fetchImpl: async () => ({ status: 503 }), targets, now: () => 0 });
  assert.equal(bad.ready, false);
  const redirect = await runNetworkProbe({ fetchImpl: async () => ({ status: 302 }), targets, now: () => 0 });
  assert.equal(redirect.ready, true);
});

function backend(kind, impl) {
  const calls = [];
  return { kind, calls, run: async (task, payload) => { calls.push(task); return impl(task, payload); } };
}

test('Router：未註冊本地就緒前一律走雲端', async () => {
  const local = backend('local', async () => 'L');
  const cloud = backend('cloud', async () => 'C');
  const r = new LocalCloudRouter(local, cloud);
  const res = await r.route('judgment', {});
  assert.equal(res.backend, 'cloud');
  assert.equal(local.calls.length, 0);
});

test('Router：註冊就緒後使用本地；本地失敗則回退雲端', async () => {
  const local = backend('local', async () => { throw new Error('boom'); });
  const cloud = backend('cloud', async () => 'C');
  const r = new LocalCloudRouter(local, cloud, { failureThreshold: 3 });
  r.registerLocalReady();
  const res = await r.route('chat', {});
  assert.equal(res.backend, 'cloud');
  assert.equal(res.fellBack, true);
  assert.equal(res.value, 'C');
});

test('Router：連續失敗達門檻後暫停本地，冷卻後恢復', async () => {
  let t = 0;
  let fail = true;
  const local = backend('local', async () => { if (fail) throw new Error('x'); return 'L'; });
  const cloud = backend('cloud', async () => 'C');
  const r = new LocalCloudRouter(local, cloud, { failureThreshold: 2, cooldownMs: 1000, now: () => t });
  r.registerLocalReady();
  await r.route('judgment', {});
  await r.route('judgment', {});
  assert.equal(r.isLocalUsable(), false, '兩次失敗後應暫停');
  const during = await r.route('judgment', {});
  assert.equal(during.backend, 'cloud');
  assert.equal(local.calls.length, 2, '暫停期間不應再呼叫本地');
  t = 1000;
  fail = false;
  assert.equal(r.isLocalUsable(), true, '冷卻後恢復');
  const after = await r.route('judgment', {});
  assert.equal(after.backend, 'local');
});

test('Router：本地成功會重設連續失敗計數', async () => {
  let fail = true;
  const local = backend('local', async () => { if (fail) throw new Error('x'); return 'L'; });
  const r = new LocalCloudRouter(local, backend('cloud', async () => 'C'), { failureThreshold: 3 });
  r.registerLocalReady();
  await r.route('crawl', {});
  await r.route('crawl', {});
  fail = false;
  await r.route('crawl', {});
  assert.equal(r.getHealth('local').consecutiveFailures, 0);
  assert.equal(r.getHealth('local').successes, 1);
});

test('Router：雲端也失敗時錯誤會往上拋', async () => {
  const r = new LocalCloudRouter(null, backend('cloud', async () => { throw new Error('cloud down'); }));
  await assert.rejects(r.route('judgment', {}), /cloud down/);
});
