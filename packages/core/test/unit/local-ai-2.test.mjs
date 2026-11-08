// 本地 AI 第二批模組的單元測試：硬體解析、Ollama 客戶端、安裝流程、增量更新、失敗回報去敏。全部使用假資料。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHardware,
  detectGpuVendor,
  parseNdjson,
  getOllamaVersion,
  hasModel,
  pullModel,
  OllamaBackend,
  runInstallFlow,
  INSTALL_STAGES,
  planUpdate,
  buildFailureReport,
  sanitizeMessage,
  LocalCloudRouter,
} from '../../dist/index.js';

const GB = 1024 ** 3;

// ---------- 硬體解析 ----------
test('parseHardware：位元組換算成 GB，並取顯示記憶體最大的顯卡', () => {
  const hw = parseHardware({
    totalMemoryBytes: 32 * GB,
    freeDiskBytes: 120 * GB,
    gpus: [
      { name: 'Intel(R) UHD Graphics', adapterRamBytes: 1 * GB },
      { name: 'NVIDIA GeForce RTX 4060', adapterRamBytes: 8 * GB },
    ],
  });
  assert.equal(hw.ramGB, 32);
  assert.equal(hw.freeDiskGB, 120);
  assert.equal(hw.gpuVendor, 'nvidia');
  assert.equal(hw.vramGB, 8);
});

test('parseHardware：缺資料時保守為 0 / none', () => {
  const hw = parseHardware({ totalMemoryBytes: null, gpus: null });
  assert.equal(hw.ramGB, 0);
  assert.equal(hw.gpuVendor, 'none');
  assert.equal(hw.vramGB, 0);
});

test('parseHardware：單一物件（非陣列）也能解析', () => {
  const hw = parseHardware({ totalMemoryBytes: 16 * GB, gpus: { name: 'AMD Radeon RX 6600', adapterRamBytes: 8 * GB } });
  assert.equal(hw.gpuVendor, 'amd');
});

test('detectGpuVendor：廠商判斷', () => {
  assert.equal(detectGpuVendor('NVIDIA RTX A2000'), 'nvidia');
  assert.equal(detectGpuVendor('AMD Radeon Graphics'), 'amd');
  assert.equal(detectGpuVendor('Intel Iris Xe'), 'intel');
  assert.equal(detectGpuVendor('Some Unknown Card'), 'other');
  assert.equal(detectGpuVendor(null), 'none');
});

// ---------- NDJSON 與 Ollama 客戶端 ----------
test('parseNdjson：略過空行；壞行指出行號', () => {
  assert.deepEqual(parseNdjson('{"a":1}\n\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
  assert.throws(() => parseNdjson('{"a":1}\nnot-json'), /第 2 行/);
});

function fakeFetch(map) {
  return async (url, init) => {
    const key = Object.keys(map).find((k) => String(url).endsWith(k));
    if (!key) throw new Error('unexpected url ' + url);
    return map[key](init);
  };
}

test('getOllamaVersion：服務在線回傳版本；離線回傳 null', async () => {
  const on = fakeFetch({ '/api/version': async () => ({ ok: true, json: async () => ({ version: '0.5.1' }) }) });
  assert.equal(await getOllamaVersion({ fetchImpl: on }), '0.5.1');
  const off = async () => { throw new TypeError('fetch failed'); };
  assert.equal(await getOllamaVersion({ fetchImpl: off }), null);
});

test('hasModel：依 /api/tags 判斷模型是否存在', async () => {
  const f = fakeFetch({ '/api/tags': async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen2.5:7b' }] }) }) });
  assert.equal(await hasModel('qwen2.5:7b', { fetchImpl: f }), true);
  assert.equal(await hasModel('qwen2.5:14b', { fetchImpl: f }), false);
});

test('pullModel：收到 success 才算完成，並回報進度', async () => {
  const body = '{"status":"pulling"}\n{"status":"downloading","completed":5,"total":10}\n{"status":"success"}\n';
  const f = fakeFetch({ '/api/pull': async () => ({ ok: true, text: async () => body }) });
  const seen = [];
  await pullModel('qwen2.5:3b', (p) => seen.push(p.status), { fetchImpl: f });
  assert.deepEqual(seen, ['pulling', 'downloading', 'success']);
});

test('pullModel：串流中出現 error → 拋錯', async () => {
  const body = '{"status":"pulling"}\n{"error":"disk full"}\n';
  const f = fakeFetch({ '/api/pull': async () => ({ ok: true, text: async () => body }) });
  await assert.rejects(pullModel('x', () => {}, { fetchImpl: f }), /disk full/);
});

test('pullModel：沒有 success → 視為未完成', async () => {
  const f = fakeFetch({ '/api/pull': async () => ({ ok: true, text: async () => '{"status":"pulling"}\n' }) });
  await assert.rejects(pullModel('x', () => {}, { fetchImpl: f }), /未完成/);
});

test('OllamaBackend：精讀用 judgment 模型，回答用 chat 模型', async () => {
  const used = [];
  const f = fakeFetch({
    '/api/chat': async (init) => {
      used.push(JSON.parse(init.body).model);
      return { ok: true, json: async () => ({ message: { content: 'ok' } }) };
    },
  });
  const b = new OllamaBackend({ judgment: 'big', chat: 'small' }, { fetchImpl: f });
  assert.equal((await b.run('judgment', { prompt: 'x' })).text, 'ok');
  await b.run('chat', { prompt: 'hi' });
  assert.deepEqual(used, ['big', 'small']);
});

test('OllamaBackend 與 LocalCloudRouter 整合：本地 HTTP 500 → 回退雲端', async () => {
  const f = fakeFetch({ '/api/chat': async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const local = new OllamaBackend({ judgment: 'a', chat: 'b' }, { fetchImpl: f });
  const cloud = { kind: 'cloud', run: async () => 'CLOUD' };
  const r = new LocalCloudRouter(local, cloud, { failureThreshold: 3 });
  r.registerLocalReady();
  const res = await r.route('chat', { prompt: 'x' });
  assert.equal(res.backend, 'cloud');
  assert.equal(res.value, 'CLOUD');
});

// ---------- 安裝流程 ----------
function okSteps(overrides = {}) {
  const s = {};
  for (const st of INSTALL_STAGES) s[st] = async () => ({ stage: st });
  return { ...s, ...overrides };
}

test('安裝流程：全部成功 → ok，階段順序正確', async () => {
  const seen = [];
  const res = await runInstallFlow(okSteps(), (st, status) => { if (status === 'done') seen.push(st); });
  assert.equal(res.ok, true);
  assert.deepEqual(res.completed, [...INSTALL_STAGES]);
  assert.deepEqual(seen, [...INSTALL_STAGES]);
});

test('安裝流程：任一步失敗 → 停止，之後的步驟不執行，且回報失敗階段', async () => {
  let registered = false;
  const res = await runInstallFlow(
    okSteps({
      pullModels: async () => { throw new Error('網路中斷'); },
      register: async () => { registered = true; },
    }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.failedAt, 'pullModels');
  assert.match(res.error, /網路中斷/);
  assert.equal(registered, false, '失敗時不可註冊本地後端');
  assert.equal(res.completed.includes('pullModels'), false);
});

test('安裝流程：使用者取消 confirmPlan → ok=false 且不進入安裝', async () => {
  let installed = false;
  const res = await runInstallFlow(
    okSteps({
      confirmPlan: async () => ({ confirmed: false }),
      installEngine: async () => { installed = true; },
    }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.failedAt, 'confirmPlan');
  assert.equal(installed, false);
  assert.match(res.error, /取消/);
});

test('安裝流程：缺少步驟實作 → 不靜默略過安全檢查', async () => {
  const steps = okSteps();
  delete steps.checkNetwork;
  const res = await runInstallFlow(steps);
  assert.equal(res.ok, false);
  assert.equal(res.failedAt, 'checkNetwork');
});

test('安裝流程：後續步驟可取得前面步驟的結果', async () => {
  const res = await runInstallFlow(
    okSteps({
      checkSystem: async () => ({ ramGB: 16 }),
      register: async (ctx) => ({ tier: ctx.checkSystem.ramGB >= 16 ? 'standard' : 'light' }),
    }),
  );
  assert.equal(res.context.register.tier, 'standard');
});

// ---------- 增量更新 ----------
test('planUpdate：只下載變動與新增，刪除已移除的檔案', () => {
  const plan = planUpdate(
    { 'apps/desktop/a.js': 'h1', 'apps/desktop/b.js': 'h2', 'docs/x.md': 'h3' },
    { 'apps/desktop/a.js': 'h1', 'apps/desktop/b.js': 'NEW', 'apps/desktop/c.js': 'h4', 'docs/x.md': 'h3' },
  );
  assert.deepEqual(plan.download, ['apps/desktop/b.js', 'apps/desktop/c.js']);
  assert.deepEqual(plan.unchanged, ['apps/desktop/a.js', 'docs/x.md']);
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.fullRequired, false);
});

test('planUpdate：共用核心（packages/core/）變動 → fullRequired', () => {
  const plan = planUpdate({ 'packages/core/src/x.js': '1' }, { 'packages/core/src/x.js': '2' });
  assert.equal(plan.fullRequired, true);
});

test('planUpdate：刪除的核心檔案也算變動', () => {
  const plan = planUpdate({ 'runtime/engine.dll': '1' }, {});
  assert.deepEqual(plan.remove, ['runtime/engine.dll']);
  assert.equal(plan.fullRequired, true);
});

// ---------- 失敗回報去敏 ----------
test('sanitizeMessage：遮蔽金鑰、Windows 路徑與電子郵件', () => {
  const s = sanitizeMessage('失敗於 C:\\Users\\alice\\AppData\\x.exe，key sk-abcdef123456，寄到 a.b@example.com');
  assert.equal(s.includes('alice'), false);
  assert.equal(s.includes('sk-abcdef'), false);
  assert.equal(s.includes('a.b@example.com'), false);
});

test('sanitizeMessage：長度上限 200 字', () => {
  assert.equal(sanitizeMessage('字'.repeat(500)).length, 200);
});

test('buildFailureReport：只含允許欄位，並去敏訊息', () => {
  const r = buildFailureReport({
    appVersion: '3.0.0', rulesVersion: 1, stage: 'pullModels', tier: 'standard',
    osVersion: 'Windows 11', message: 'Bearer abc.def 出錯於 C:\\Users\\bob\\x',
  });
  assert.deepEqual(Object.keys(r).sort(), ['appVersion', 'message', 'osVersion', 'rulesVersion', 'stage', 'tier']);
  assert.equal(r.message.includes('bob'), false);
  assert.equal(r.message.includes('abc.def'), false);
});
