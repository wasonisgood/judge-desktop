// 個案研究筆記雲端同步測試：酬載內容（不含全文、含四色名稱與墓碑）、權杖缺失／過期、
// 衝突（伺服器版本較新）合併與重送、重送次數上限、HTTP 傳輸與回應格式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const require = createRequire(import.meta.url);
const svc = require('../dist/main/services/annotationService.js');
const sync = require('../dist/main/services/annotationSync.js');

const FULL = '主文：上訴駁回。\n事實：被告於民國一一〇年三月間持刀威脅告訴人。\n理由：被告所辯不足採。';
const META = { title: '測試案', caseNo: '110年度上訴字第1號', court: '臺灣高等法院', dateIso: '2021-03-01', cause: '恐嚇', sourceUrl: 'https://example.test/x', jurisdiction: '' };
const T0 = '2026-11-10T00:00:00.000Z';
const T1 = '2026-11-10T01:00:00.000Z';
const T2 = '2026-11-10T02:00:00.000Z';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annsync-'));
  return new svc.AnnotationStore(path.join(dir, 'annotations.json'));
}
function ann(id, updatedAt, overrides = {}) {
  return {
    id, judgmentId: 'J1', start: 0, end: 2, quote: '主文', textHash: 'h', color: 'yellow', mode: 'highlight', note: '',
    origin: 'manual', createdAt: T0, updatedAt, ...overrides,
  };
}
function payload(exportedAt, judgments = [], extra = {}) {
  return { schemaVersion: 1, exportedAt, judgments, tombstones: [], ...extra };
}
const J = (anns, meta = META, judgmentId = 'J1') => ({ judgmentId, meta, annotations: anns });

// ---------- 酬載 ----------

test('酬載只含標注、註解、判決快照、四色名稱與墓碑；不含判決全文', async () => {
  const store = tmpStore();
  const start = FULL.indexOf('持刀');
  await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight_note', note: '威脅要件' }, FULL);
  await store.setColorLabels({ pink: '暴力要件' });
  const payload1 = sync.buildSyncPayload(await store.read(), new Date('2026-11-10T00:00:00Z'));
  const text = JSON.stringify(payload1);
  assert.equal(payload1.schemaVersion, 1);
  assert.equal(payload1.judgments[0].judgmentId, 'J1');
  assert.equal(payload1.judgments[0].annotations[0].note, '威脅要件');
  assert.equal(payload1.colorLabels.pink, '暴力要件');
  assert.equal(payload1.colorLabels.yellow, '事實', '完整四色');
  assert.ok(!text.includes('上訴駁回'), '不得含判決全文');
  assert.ok(!text.includes('被告於民國'), '不得含判決全文');
  assert.ok(!('fullText' in payload1) && !JSON.stringify(payload1).includes('fullText'));
  assert.ok(sync.isSyncPayload(payload1));
});

test('酬載包含刪除墓碑；未自訂名稱時不帶 colorLabels', async () => {
  const store = tmpStore();
  const start = FULL.indexOf('持刀');
  const a = await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight' }, FULL);
  await store.remove('J1', a.id);
  const p = sync.buildSyncPayload(await store.read());
  assert.equal(p.tombstones.length, 1);
  assert.equal(p.tombstones[0].id, a.id);
  assert.equal(p.tombstones[0].judgmentId, 'J1');
  assert.equal(p.colorLabels, undefined);
  assert.deepEqual(p.judgments, []);
});

test('酬載驗證：形狀不符的回應被拒絕', () => {
  assert.equal(sync.isSyncPayload(null), false);
  assert.equal(sync.isSyncPayload({ schemaVersion: 1, exportedAt: T0, judgments: 'x', tombstones: [] }), false);
  assert.equal(sync.isSyncPayload({ schemaVersion: 1, exportedAt: T0, judgments: [{ judgmentId: 'J', meta: {}, annotations: [] }], tombstones: [{ id: 1 }] }), false);
  assert.equal(sync.isSyncPayload(payload(T0)), true);
});

// ---------- 合併（純函式） ----------

test('合併：同一標注以 updatedAt 較新者為準；兩裝置的新標注都保留', () => {
  const local = payload(T1, [J([ann('a', T0, { note: '舊' }), ann('b', T1)])]);
  const remote = payload(T2, [J([ann('a', T2, { note: '新' }), ann('c', T2)])]);
  const m = sync.mergePayloads(local, remote, new Date(T2));
  const anns = m.judgments[0].annotations;
  assert.deepEqual(anns.map((x) => x.id).sort(), ['a', 'b', 'c']);
  assert.equal(anns.find((x) => x.id === 'a').note, '新');
});

test('合併：墓碑不早於標注更新時，該標注不保留；墓碑較舊則保留標注', () => {
  const local = payload(T1, [J([ann('a', T1), ann('b', T2)])]);
  const remote = payload(T2, [], { tombstones: [
    { id: 'a', judgmentId: 'J1', deletedAt: T2 },  // 刪除晚於 a 的更新 → 刪除
    { id: 'b', judgmentId: 'J1', deletedAt: T0 },  // 刪除早於 b 的更新 → 保留
  ] });
  const m = sync.mergePayloads(local, remote, new Date(T2));
  assert.deepEqual(m.judgments[0].annotations.map((x) => x.id), ['b']);
  assert.equal(m.tombstones.length, 2, '墓碑保留以免舊版本再帶回');
});

test('合併：沒有標注的判決不保留；判決快照取較新的酬載；四色名稱取較新且有自訂者', () => {
  const oldMeta = { ...META, title: '舊標題' };
  const local = payload(T0, [J([ann('a', T0)], oldMeta)], { colorLabels: { yellow: '甲', green: '爭點', pink: '主文', blue: '理由' } });
  const remote = payload(T2, [J([ann('a', T0)], META), J([], META, 'J2')], { colorLabels: { yellow: '乙', green: '爭點', pink: '主文', blue: '理由' } });
  const m = sync.mergePayloads(local, remote, new Date(T2));
  assert.equal(m.judgments.length, 1);
  assert.equal(m.judgments[0].meta.title, '測試案');
  assert.equal(m.colorLabels.yellow, '乙');
});

// ---------- 權杖缺失與過期 ----------

test('權杖缺失：HTTP 傳輸直接拋出可理解的錯誤，且不送出網路請求', async () => {
  let called = 0;
  const transport = new sync.HttpSyncTransport({
    url: 'https://example.test/api/annotations',
    getToken: async () => null,
    fetchImpl: async () => { called++; return new Response('{}'); },
  });
  await assert.rejects(transport.put({ baseRevision: 0, payload: payload(T0) }), (e) => e instanceof sync.SyncAuthError && e.message === sync.MSG_NOT_SIGNED_IN);
  assert.equal(called, 0);
});

test('權杖缺失：runSync 不改動本機資料', async () => {
  const store = tmpStore();
  const start = FULL.indexOf('持刀');
  await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight' }, FULL);
  const before = JSON.stringify(await store.read());
  const transport = new sync.HttpSyncTransport({ url: 'https://example.test/api/annotations', getToken: async () => null, fetchImpl: async () => new Response('{}') });
  await assert.rejects(sync.runSync(store, transport), sync.SyncAuthError);
  assert.equal(JSON.stringify(await store.read()), before);
});

test('權杖過期（伺服器 401／403）：拋出重新登入的錯誤', async () => {
  for (const status of [401, 403]) {
    const transport = new sync.HttpSyncTransport({
      url: 'https://example.test/api/annotations', getToken: async () => 'tok',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'invalid_token' }), { status }),
    });
    await assert.rejects(transport.put({ baseRevision: 0, payload: payload(T0) }), (e) => e instanceof sync.SyncAuthError && e.message === sync.MSG_EXPIRED);
  }
});

// ---------- HTTP 傳輸 ----------

test('HTTP：以 Bearer 權杖 PUT { baseRevision, payload }，回應 200 取得版本號', async () => {
  let seen = null;
  const transport = new sync.HttpSyncTransport({
    url: 'https://example.test/api/annotations', getToken: async () => 'tok-123',
    fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ revision: 7 }), { status: 200 }); },
  });
  const r = await transport.put({ baseRevision: 6, payload: payload(T0) });
  assert.deepEqual(r, { status: 'ok', revision: 7 });
  assert.equal(seen.url, 'https://example.test/api/annotations');
  assert.equal(seen.init.method, 'PUT');
  assert.equal(seen.init.headers.authorization, 'Bearer tok-123');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.baseRevision, 6);
  assert.equal(body.payload.schemaVersion, 1);
});

test('HTTP：409 回傳伺服器版本號與酬載；回應格式不符時拋錯', async () => {
  const serverPayload = payload(T2, [J([ann('s', T2)])]);
  const ok = new sync.HttpSyncTransport({
    url: 'u', getToken: async () => 't',
    fetchImpl: async () => new Response(JSON.stringify({ revision: 9, payload: serverPayload }), { status: 409 }),
  });
  const r = await ok.put({ baseRevision: 3, payload: payload(T0) });
  assert.equal(r.status, 'conflict');
  assert.equal(r.revision, 9);
  assert.equal(r.payload.judgments[0].annotations[0].id, 's');

  const bad = new sync.HttpSyncTransport({
    url: 'u', getToken: async () => 't', fetchImpl: async () => new Response(JSON.stringify({ revision: 9, payload: { nope: 1 } }), { status: 409 }),
  });
  await assert.rejects(bad.put({ baseRevision: 3, payload: payload(T0) }), /格式不正確/);
});

test('HTTP：網路失敗、伺服器錯誤與超過大小上限都有明確訊息', async () => {
  const net = new sync.HttpSyncTransport({ url: 'u', getToken: async () => 't', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(net.put({ baseRevision: 0, payload: payload(T0) }), /無法連線.*本機資料不受影響/);
  const srv = new sync.HttpSyncTransport({ url: 'u', getToken: async () => 't', fetchImpl: async () => new Response('x', { status: 500 }) });
  await assert.rejects(srv.put({ baseRevision: 0, payload: payload(T0) }), /同步失敗（伺服器回應 500）/);
  let called = 0;
  const big = new sync.HttpSyncTransport({ url: 'u', getToken: async () => 't', fetchImpl: async () => { called++; return new Response('{}'); } });
  const huge = payload(T0, [J([ann('x', T0, { note: 'n'.repeat(sync.SYNC_MAX_BYTES) })])]);
  await assert.rejects(big.put({ baseRevision: 0, payload: huge }), /上限/);
  assert.equal(called, 0, '超過上限時不送出');
});

// ---------- 同步流程（runSync） ----------

test('同步成功：只更新版本號，不改動標注', async () => {
  const store = tmpStore();
  const start = FULL.indexOf('持刀');
  await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight' }, FULL);
  const transport = { put: async () => ({ status: 'ok', revision: 4 }) };
  const r = await sync.runSync(store, transport);
  assert.equal(r.revision, 4);
  assert.equal(r.merged, false);
  assert.equal(r.annotations, 1);
  const f = await store.read();
  assert.equal(f.syncRevision, 4);
  assert.equal(f.judgments.J1.annotations.length, 1);
});

test('衝突（伺服器較新）：合併後套回本機，以伺服器版本號重送，結果同時包含兩邊的變更', async () => {
  const store = tmpStore();
  const start = FULL.indexOf('持刀');
  const mine = await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight' }, FULL);
  // 伺服器版本（另一台裝置）：刪除了本機的 mine，並新增一則標注
  const serverPayload = payload(new Date(Date.now() + 60_000).toISOString(), [J([
    ann('theirs', new Date(Date.now() + 60_000).toISOString(), { judgmentId: 'J1', quote: '所辯' }),
  ])], { tombstones: [{ id: mine.id, judgmentId: 'J1', deletedAt: new Date(Date.now() + 60_000).toISOString() }] });
  const calls = [];
  const transport = {
    put: async (req) => {
      calls.push(req);
      if (calls.length === 1) return { status: 'conflict', revision: 12, payload: serverPayload };
      return { status: 'ok', revision: 13 };
    },
  };
  const r = await sync.runSync(store, transport);
  assert.equal(r.merged, true);
  assert.equal(r.revision, 13);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].baseRevision, 12, '重送時使用伺服器版本號');
  const sentIds = calls[1].payload.judgments[0].annotations.map((a) => a.id);
  assert.deepEqual(sentIds, ['theirs'], '被伺服器刪除的標注不再送出');
  const f = await store.read();
  assert.equal(f.syncRevision, 13);
  assert.ok(f.tombstones[mine.id], '刪除紀錄保留');
  assert.equal(f.judgments.J1.annotations[0].id, 'theirs');
});

test('衝突：本機與伺服器各有新標注時兩者都保留', async () => {
  const store = tmpStore();
  const start = FULL.indexOf('持刀');
  await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight' }, FULL);
  const serverPayload = payload(new Date(Date.now() + 60_000).toISOString(), [J([ann('remote-only', new Date(Date.now() + 60_000).toISOString())])]);
  let n = 0;
  const transport = { put: async () => (n++ === 0 ? { status: 'conflict', revision: 2, payload: serverPayload } : { status: 'ok', revision: 3 }) };
  await sync.runSync(store, transport);
  const ids = (await store.read()).judgments.J1.annotations.map((a) => a.id);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes('remote-only'));
});

test('衝突無法解決（重送仍衝突）：超過次數後拋錯，本機資料已合併保存', async () => {
  const store = tmpStore();
  let attempts = 0;
  const transport = { put: async () => { attempts++; return { status: 'conflict', revision: attempts, payload: payload(T2) }; } };
  await assert.rejects(sync.runSync(store, transport), /同步衝突無法解決/);
  assert.equal(attempts, sync.SYNC_MAX_ATTEMPTS);
});

test('端到端：HTTP 傳輸遇到 409 後合併並以 200 完成', async () => {
  const store = tmpStore();
  const start = FULL.indexOf('持刀');
  await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'blue', mode: 'highlight' }, FULL);
  const serverPayload = payload(new Date(Date.now() + 60_000).toISOString(), [], { colorLabels: { yellow: '事實', green: '爭點', pink: '暴力', blue: '理由' } });
  const bodies = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    i++;
    return i === 1
      ? new Response(JSON.stringify({ revision: 5, payload: serverPayload }), { status: 409 })
      : new Response(JSON.stringify({ revision: 6 }), { status: 200 });
  };
  const transport = new sync.HttpSyncTransport({ url: 'https://example.test/api/annotations', getToken: async () => 'tok', fetchImpl });
  const r = await sync.runSync(store, transport);
  assert.equal(r.revision, 6);
  assert.equal(bodies[1].baseRevision, 5);
  assert.equal(bodies[1].payload.colorLabels.pink, '暴力', '伺服器的四色名稱被採用');
  assert.equal((await store.read()).syncRevision, 6);
});

test('同步狀態：有權杖可同步，沒有權杖時說明未登入', () => {
  assert.equal(sync.syncStatus(true).available, true);
  const off = sync.syncStatus(false);
  assert.equal(off.available, false);
  assert.equal(off.reason, sync.MSG_NOT_SIGNED_IN);
});

test('刪除標注會留下墓碑（同步時避免被舊版本帶回）', async () => {
  const store = tmpStore();
  const start = FULL.indexOf('持刀');
  const a = await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight' }, FULL);
  await store.remove('J1', a.id);
  const f = await store.read();
  assert.equal(f.tombstones[a.id].judgmentId, 'J1');
  assert.ok(f.tombstones[a.id].deletedAt);
});
