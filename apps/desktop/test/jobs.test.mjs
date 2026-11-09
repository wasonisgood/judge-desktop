// v3.6.0 工作登記表：取消、狀態、同類互斥、同一識別碼不可重複。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jobs = require('../dist/main/services/jobRegistry.js');

test('withJob：正常完成 → done；取消 → cancelled；例外 → failed', async () => {
  const ok = await jobs.withJob('t-ok', 'search', '正常', async () => 42);
  assert.equal(ok, 42);
  assert.equal(jobs.listJobs().find((j) => j.id === 't-ok').status, 'done');

  await jobs.withJob('t-cancel', 'scope', '取消', async (signal) => {
    jobs.cancelJob('t-cancel');
    assert.equal(signal.aborted, true);
    return 'partial';
  });
  assert.equal(jobs.listJobs().find((j) => j.id === 't-cancel').status, 'cancelled');

  await assert.rejects(jobs.withJob('t-fail', 'brief', '失敗', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(jobs.listJobs().find((j) => j.id === 't-fail').status, 'failed');
});

test('cancelJob：找不到或已結束的工作回傳 false', async () => {
  assert.equal(jobs.cancelJob('no-such-job'), false);
  await jobs.withJob('t-done', 'search', '完成', async () => 1);
  assert.equal(jobs.cancelJob('t-done'), false);
});

test('beginJob：同一識別碼執行中不可重複登記', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = jobs.withJob('t-dup', 'search', '第一次', () => gate);
  assert.throws(() => jobs.beginJob('t-dup', 'search', '第二次'), /已在執行中/);
  release();
  await first;
});

test('互斥：安裝與修復不可同時進行，其他類別不受影響', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const install = jobs.withJob('t-install', 'install', '安裝', () => gate);
  assert.throws(() => jobs.beginJob('t-repair', 'repair', '修復'), /已有「安裝」進行中/);
  // 非互斥類別仍可進行
  await jobs.withJob('t-search-during-install', 'search', '搜尋', async () => 'ok');
  release();
  await install;
});

test('signalOfRunning：只回傳執行中指定類別工作的訊號', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = jobs.withJob('t-sig', 'repair', '修復', async (signal) => { await gate; return signal; });
  const sig = jobs.signalOfRunning(['install', 'repair']);
  assert.ok(sig);
  assert.equal(jobs.signalOfRunning(['scope']), undefined);
  release();
  await p;
  assert.equal(jobs.signalOfRunning(['install', 'repair']), undefined);
});

test('runningCount 與 setJobListeners：完成時通知，並可判斷是否仍有工作', async () => {
  const ends = [];
  jobs.setJobListeners(() => undefined, (info) => ends.push(info.id));
  await jobs.withJob('t-listen', 'assistant', '對話', async () => 1);
  assert.deepEqual(ends.includes('t-listen'), true);
  assert.equal(jobs.runningCount(), 0);
});
