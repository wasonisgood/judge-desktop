// 模組化測試：兩個模組的狀態彼此獨立、各自的更新計畫、爬取模組安裝流程，以及 Ollama 串流拉取模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ModuleRegistry, planModuleUpdate, installCrawlerModule, pullModel, CRAWLER_STAGES,
} from '../../dist/index.js';

test('ModuleRegistry：更新 ai-engine 不會改動 crawler 的狀態（獨立）', () => {
  const r = new ModuleRegistry();
  r.set('crawler', { installedVersion: '1.0.0', status: 'ready' });
  const before = r.get('crawler');
  r.set('ai-engine', { installedVersion: '2.0.0', status: 'ready', lastError: null }, () => '2026-01-01T00:00:00.000Z');
  assert.deepEqual(r.get('crawler'), before);
  assert.equal(r.get('ai-engine').installedVersion, '2.0.0');
});

test('ModuleRegistry：單一模組失敗不會把另一個模組標成失敗', () => {
  const r = new ModuleRegistry();
  r.set('ai-engine', { status: 'failed', lastError: '磁碟不足', failedStage: 'pullModels' });
  assert.equal(r.get('crawler').status, 'not-installed');
  assert.equal(r.get('crawler').lastError, null);
});

test('ModuleRegistry：初始狀態為未安裝，且 toJSON 含兩個模組', () => {
  const j = new ModuleRegistry().toJSON();
  assert.equal(j['ai-engine'].status, 'not-installed');
  assert.equal(j.crawler.status, 'not-installed');
});

test('planModuleUpdate：只針對該模組的檔案，並帶出版本', () => {
  const plan = planModuleUpdate(
    'ai-engine',
    { id: 'ai-engine', version: '1.0.0', files: { 'modules/ai-engine/a.json': 'h1', 'modules/ai-engine/b.json': 'h2' } },
    { id: 'ai-engine', version: '1.1.0', files: { 'modules/ai-engine/a.json': 'h1', 'modules/ai-engine/b.json': 'NEW' } },
  );
  assert.deepEqual(plan.download, ['modules/ai-engine/b.json']);
  assert.equal(plan.fromVersion, '1.0.0');
  assert.equal(plan.toVersion, '1.1.0');
  assert.equal(plan.moduleId, 'ai-engine');
  assert.equal(plan.fullRequired, false);
});

test('planModuleUpdate：模組自己的核心檔案變動 → 整包下載（fullRequired）', () => {
  const plan = planModuleUpdate(
    'crawler',
    { id: 'crawler', version: '1.0.0', files: { 'modules/crawler/core/x.js': '1' } },
    { id: 'crawler', version: '1.0.1', files: { 'modules/crawler/core/x.js': '2' } },
  );
  assert.equal(plan.fullRequired, true);
});

test('planModuleUpdate：模組 id 不符 → 拋錯（避免把 A 模組的清單套到 B）', () => {
  assert.throws(() => planModuleUpdate('crawler', null, { id: 'ai-engine', version: '1', files: {} }), /模組不符/);
});

test('planModuleUpdate：首次安裝（舊清單為 null）→ 全部下載', () => {
  const plan = planModuleUpdate('crawler', null, { id: 'crawler', version: '1.0.0', files: { 'a.js': 'h', 'b.js': 'h' } });
  assert.deepEqual(plan.download, ['a.js', 'b.js']);
  assert.equal(plan.fromVersion, null);
});

test('installCrawlerModule：全部通過 → ok 且 register 被呼叫', async () => {
  let registered = false;
  const res = await installCrawlerModule({
    probe: async () => ({ ready: true, results: [], messages: [] }),
    smokeFetch: async () => [{ id: 'TPHV,111,1' }],
    register: () => { registered = true; },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.completed, [...CRAWLER_STAGES]);
  assert.equal(registered, true);
});

test('installCrawlerModule：網路未就緒 → 停在 checkNetwork，不註冊', async () => {
  let registered = false;
  const res = await installCrawlerModule({
    probe: async () => ({ ready: false, results: [], messages: ['司法院網站無法連線'] }),
    smokeFetch: async () => [1],
    register: () => { registered = true; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.failedAt, 'checkNetwork');
  assert.equal(registered, false);
  assert.match(res.error, /無法連線/);
});

test('installCrawlerModule：煙霧測試沒有資料 → 不註冊', async () => {
  let registered = false;
  const res = await installCrawlerModule({
    probe: async () => ({ ready: true, results: [], messages: [] }),
    smokeFetch: async () => [],
    register: () => { registered = true; },
  });
  assert.equal(res.failedAt, 'smokeFetch');
  assert.equal(registered, false);
});

test('pullModel：以真正的 Response 串流（分段到達）解析進度', async () => {
  const parts = ['{"status":"pulling"}\n{"status":"downloading","completed":', '5,"total":10}\n{"status":"success"}\n'];
  const body = new ReadableStream({
    start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); },
  });
  const fakeFetch = async () => new Response(body, { status: 200 });
  const seen = [];
  await pullModel('m', (p) => seen.push(p.status), { fetchImpl: fakeFetch });
  assert.deepEqual(seen, ['pulling', 'downloading', 'success']);
});

test('pullModel：串流中的 error 行會中止並拋錯', async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"error":"model not found"}\n')); c.close(); } });
  await assert.rejects(pullModel('m', () => {}, { fetchImpl: async () => new Response(body, { status: 200 }) }), /model not found/);
});
