// v3.9.0 背景工人佇列：狀態轉換、中斷與續跑、持久化容錯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const q = require('../dist/main/services/workerQueue.js');

const input = (id, extra = {}) => ({ id, kind: 'scope', label: `工作 ${id}`, payload: { statutes: ['民法'] }, page: 'scope', ...extra });

test('排隊 → 執行 → 完成：摘要與結束時間寫入，且不修改輸入陣列', () => {
  const a0 = q.enqueueItem([], input('a'), 100);
  const snapshot = JSON.stringify(a0);
  const a1 = q.startItem(a0, 'a', 200);
  assert.equal(a1[0].status, 'running');
  assert.equal(a1[0].startedAt, 200);
  const a2 = q.completeItem(a1, 'a', { summary: '找到 12 件' }, 300);
  assert.equal(a2[0].status, 'done');
  assert.equal(a2[0].summary, '找到 12 件');
  assert.equal(a2[0].endedAt, 300);
  assert.equal(a2[0].attention, false);
  assert.equal(JSON.stringify(a0), snapshot, '輸入不可被修改');
});

test('完成但需要確認：attention 為 true', () => {
  const items = q.completeItem(q.startItem(q.enqueueItem([], input('b'), 1), 'b', 2), 'b', { summary: '法名有多個候選', attention: true }, 3);
  assert.equal(items[0].attention, true);
});

test('失敗：執行中才能標記失敗，並保留錯誤說明', () => {
  const items = q.failItem(q.startItem(q.enqueueItem([], input('c'), 1), 'c', 2), 'c', '連線逾時', 3);
  assert.equal(items[0].status, 'failed');
  assert.equal(items[0].error, '連線逾時');
});

test('非法轉換一律拋出 InvalidTransition', () => {
  const queued = q.enqueueItem([], input('d'), 1);
  assert.throws(() => q.completeItem(queued, 'd', { summary: 'x' }, 2), q.InvalidTransition);
  assert.throws(() => q.resumeItem(queued, 'd'), q.InvalidTransition);
  assert.throws(() => q.startItem(queued, 'missing', 2), q.InvalidTransition);
  const done = q.completeItem(q.startItem(queued, 'd', 2), 'd', { summary: 'ok' }, 3);
  assert.throws(() => q.cancelItem(done, 'd', 4), q.InvalidTransition);
});

test('重複識別碼與空識別碼不可加入', () => {
  const items = q.enqueueItem([], input('e'), 1);
  assert.throws(() => q.enqueueItem(items, input('e'), 2), /已存在/);
  assert.throws(() => q.enqueueItem([], input(''), 2), /不可為空/);
});

test('取消：排隊中與執行中可取消；已結束的不行', () => {
  const queued = q.enqueueItem([], input('f'), 1);
  assert.equal(q.cancelItem(queued, 'f', 2)[0].status, 'cancelled');
  const running = q.startItem(queued, 'f', 3);
  assert.equal(q.cancelItem(running, 'f', 4)[0].status, 'cancelled');
});

test('一次只執行一項：執行中時 nextQueued 不回傳下一項', () => {
  let items = q.enqueueItem([], input('g1'), 1);
  items = q.enqueueItem(items, input('g2'), 2);
  assert.equal(q.nextQueued(items).id, 'g1');
  items = q.startItem(items, 'g1', 3);
  assert.equal(q.nextQueued(items), undefined);
  items = q.completeItem(items, 'g1', { summary: 'ok' }, 4);
  assert.equal(q.nextQueued(items).id, 'g2');
});

test('中斷與續跑：程式結束時執行中的工作變成中斷，續跑後回到排隊', () => {
  let items = q.enqueueItem([], input('h'), 1);
  items = q.startItem(items, 'h', 2);
  items = q.interruptAllRunning(items, 3);
  assert.equal(items[0].status, 'interrupted');
  assert.match(items[0].error, /可於下次開啟時續跑/);
  assert.deepEqual(q.resumableItems(items).map((x) => x.id), ['h']);
  // 續跑前 payload 不變
  assert.deepEqual(items[0].payload, { statutes: ['民法'] });
  items = q.resumeItem(items, 'h');
  assert.equal(items[0].status, 'queued');
  assert.equal(items[0].error, null);
  assert.deepEqual(q.resumableItems(items), []);
});

test('磁碟上殘留的執行中工作，啟動時視為中斷（異常結束）', () => {
  const text = q.serializeQueue(q.startItem(q.enqueueItem([], input('i'), 1), 'i', 2));
  const restored = q.recoverAfterRestart(q.parseQueue(text), 9);
  assert.equal(restored[0].status, 'interrupted');
  assert.equal(restored[0].endedAt, 9);
});

test('移除：執行中不可移除；其他狀態可移除', () => {
  const running = q.startItem(q.enqueueItem([], input('j'), 1), 'j', 2);
  assert.throws(() => q.removeItem(running, 'j'), q.InvalidTransition);
  const interrupted = q.interruptItem(running, 'j', 3);
  assert.deepEqual(q.removeItem(interrupted, 'j'), []);
});

test('持久化：序列化後可完整讀回；損毀或不合法的項目被略過', () => {
  let items = q.enqueueItem([], input('k'), 1);
  items = q.completeItem(q.startItem(items, 'k', 2), 'k', { summary: '摘要', attention: true }, 3);
  const back = q.parseQueue(q.serializeQueue(items));
  assert.deepEqual(back, items);

  assert.deepEqual(q.parseQueue('not json'), []);
  assert.deepEqual(q.parseQueue('{"version":1}'), []);
  const mixed = JSON.stringify({
    version: 1,
    items: [
      null,
      { id: 'bad-status', kind: 'scope', label: 'x', status: 'weird' },
      { id: 'no-label', kind: 'scope', status: 'queued' },
      { id: 'ok', kind: 'scope', label: '好的', status: 'queued', payload: 1 },
      { id: 'ok', kind: 'scope', label: '重複', status: 'queued' },
    ],
  });
  const parsed = q.parseQueue(mixed);
  assert.deepEqual(parsed.map((x) => x.id), ['ok']);
  assert.equal(parsed[0].payload, 1);
});

test('pruneFinished：超過上限時只移除最舊的已結束工作，執行中與排隊中的保留', () => {
  let items = [];
  for (let i = 0; i < 5; i += 1) {
    items = q.enqueueItem(items, input(`p${i}`), i);
    items = q.completeItem(q.startItem(items, `p${i}`, i), `p${i}`, { summary: 's' }, 100 + i);
  }
  items = q.enqueueItem(items, input('live'), 999);
  const pruned = q.pruneFinished(items, 2);
  const ids = pruned.map((x) => x.id);
  assert.ok(ids.includes('live'));
  assert.deepEqual(ids.filter((x) => x !== 'live'), ['p3', 'p4']);
  assert.equal(q.pruneFinished(items, 10), items);
});

test('進度：只在執行中可更新，中斷後保留，讀回也保留', () => {
  let items = q.enqueueItem([], input('m'), 1);
  assert.throws(() => q.setProgress(items, 'm', '1/3'), q.InvalidTransition);
  items = q.setProgress(q.startItem(items, 'm', 2), 'm', '2/12 件');
  assert.equal(items[0].progress, '2/12 件');
  items = q.interruptAllRunning(items, 3);
  assert.equal(q.parseQueue(q.serializeQueue(items))[0].progress, '2/12 件');
});
