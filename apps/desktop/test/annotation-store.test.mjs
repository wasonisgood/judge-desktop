// 個案研究筆記的儲存測試：新增、對位狀態、更新、刪除、重新對位、格式損毀時不覆寫、雲端同步酬載不含全文。
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

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-'));
  return { dir, file: path.join(dir, 'annotations.json'), store: new svc.AnnotationStore(path.join(dir, 'annotations.json')) };
}

test('新增標注：區段、顏色、模式與引用文字正確，寫入檔案含 schemaVersion', async () => {
  const { file, store } = tmpStore();
  const start = FULL.indexOf('持刀');
  const a = await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight_note', note: '威脅要件' }, FULL);
  assert.equal(a.quote, '持刀');
  assert.equal(a.status, 'ok');
  assert.equal(a.note, '威脅要件');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.judgments.J1.annotations.length, 1);
  assert.equal(saved.judgments.J1.meta.title, '測試案');
});

test('讀取時對位：全文變動後標注為 needs_reanchor，且可在唯一出現時重新對位', async () => {
  const { store } = tmpStore();
  const start = FULL.indexOf('持刀');
  await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'yellow', mode: 'highlight' }, FULL);
  const changed = FULL.replace('主文：上訴駁回。', '主文：原判決廢棄。');
  const [view] = await store.list('J1', changed);
  assert.equal(view.status, 'needs_reanchor');
  const moved = await store.reanchor('J1', view.id, changed);
  assert.ok(moved, '引用文字唯一出現，應可對位');
  assert.equal(moved.status, 'ok');
  assert.equal(moved.start, changed.indexOf('持刀'));
});

test('重新對位失敗：引用文字不存在或出現多次時回傳 null，標注不變', async () => {
  const { store } = tmpStore();
  const dup = '甲乙甲乙';
  const start = dup.indexOf('甲乙');
  await store.add('J2', META, { judgmentId: 'J2', start, end: start + 2, color: 'green', mode: 'highlight' }, dup);
  const [v] = await store.list('J2', '甲乙和甲乙都在');
  assert.equal(await store.reanchor('J2', v.id, '甲乙和甲乙都在'), null, '出現多次不猜');
  const [w] = await store.list('J2', '完全不同的內容');
  assert.equal(await store.reanchor('J2', w.id, '完全不同的內容'), null, '找不到不猜');
  const [still] = await store.list('J2', '完全不同的內容');
  assert.equal(still.status, 'needs_reanchor');
});

test('更新與刪除：可改顏色、模式與註解；只畫螢光會清除註解；刪除後不再存在', async () => {
  const { store } = tmpStore();
  const start = FULL.indexOf('持刀');
  const a = await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'yellow', mode: 'highlight_note', note: '原註解' }, FULL);
  await store.update('J1', a.id, { color: 'blue', note: '新註解' });
  let [v] = await store.list('J1', FULL);
  assert.equal(v.color, 'blue');
  assert.equal(v.note, '新註解');
  await store.update('J1', a.id, { mode: 'highlight' });
  [v] = await store.list('J1', FULL);
  assert.equal(v.note, '', '只畫螢光時註解清空');
  assert.equal(await store.remove('J1', a.id), true);
  assert.equal((await store.list('J1', FULL)).length, 0);
  assert.equal(await store.remove('J1', 'nope'), false);
});

test('不合法的區段或顏色直接拒絕（不做靜默修正）', async () => {
  const { store } = tmpStore();
  await assert.rejects(store.add('J1', META, { judgmentId: 'J1', start: 0, end: 9999, color: 'yellow', mode: 'highlight' }, FULL), /超出/);
  await assert.rejects(store.add('J1', META, { judgmentId: 'J1', start: 0, end: 2, color: 'purple', mode: 'highlight' }, FULL), /顏色/);
});

test('格式損毀或版本較新時拋錯，且不覆寫原檔', async () => {
  const { file, store } = tmpStore();
  fs.writeFileSync(file, '{ 這不是 JSON', 'utf8');
  await assert.rejects(store.read(), /格式損毀/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ 這不是 JSON', '損毀檔案不可被覆寫');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, judgments: {} }), 'utf8');
  await assert.rejects(store.read(), /較新的版本/);
});

test('不存在的檔案視為空資料；依 judgmentId 分開存取', async () => {
  const { store } = tmpStore();
  assert.deepEqual(await store.listJudgments(), []);
  const start = FULL.indexOf('持刀');
  await store.add('A', META, { judgmentId: 'A', start, end: start + 2, color: 'yellow', mode: 'highlight' }, FULL);
  await store.add('B', { ...META, title: '另一案' }, { judgmentId: 'B', start: 0, end: 2, color: 'green', mode: 'highlight' }, FULL);
  assert.equal((await store.list('A', FULL)).length, 1);
  assert.equal((await store.list('B', FULL)).length, 1);
  const list = await store.listJudgments();
  assert.deepEqual(list.map((x) => x.judgmentId).sort(), ['A', 'B']);
});

test('純函式：addToFile 不改動原物件；patchInFile 找不到時拋錯', () => {
  const f0 = svc.emptyAnnotationFile();
  const { file: f1, annotation } = svc.addToFile(f0, 'J', META, { judgmentId: 'J', start: 0, end: 2, color: 'blue', mode: 'highlight' }, FULL);
  assert.equal(f0.judgments.J, undefined);
  assert.equal(f1.judgments.J.annotations[0].id, annotation.id);
  assert.throws(() => svc.patchInFile(f1, 'J', 'missing', { color: 'pink' }), /找不到/);
});

test('顏色名稱：預設為事實／爭點／主文／理由；自訂後保存在檔案頂層且 schemaVersion 不變；空白或過長拒絕', async () => {
  const { file, store } = tmpStore();
  assert.deepEqual(await store.getColorLabels(), { yellow: '事實', green: '爭點', pink: '主文', blue: '理由' });
  const saved = await store.setColorLabels({ yellow: ' 事實認定 ', blue: '法律見解' });
  assert.equal(saved.yellow, '事實認定', '去除前後空白');
  assert.equal(saved.green, '爭點', '未填的沿用預設');
  assert.equal(saved.blue, '法律見解');
  const f = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(f.schemaVersion, 1);
  assert.equal(f.colorLabels.blue, '法律見解');
  assert.deepEqual(await store.getColorLabels(), saved);
  // 其他資料不受影響
  const start = FULL.indexOf('持刀');
  await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight' }, FULL);
  await store.setColorLabels({ pink: '暴力要件' });
  assert.equal((await store.list('J1', FULL)).length, 1, '改名不影響標注');
  await assert.rejects(store.setColorLabels({ yellow: '   ' }), /不可空白/);
  await assert.rejects(store.setColorLabels({ yellow: '這個名稱實在是太長了超過十二個字' }), /最多 12 字/);
  await assert.rejects(store.setColorLabels({ yellow: 'a\nb' }), /換行/);
  await assert.rejects(store.setColorLabels({ yellow: 3 }), /必須是文字/);
  assert.equal((await store.getColorLabels()).yellow, '事實認定', '驗證失敗不改動既有名稱');
});

test('雲端同步酬載：只含標注與判決快照，不含判決全文；未設定後端時明確回報不可用', async () => {
  const { store, file } = tmpStore();
  const start = FULL.indexOf('持刀');
  await store.add('J1', META, { judgmentId: 'J1', start, end: start + 2, color: 'pink', mode: 'highlight_note', note: 'n' }, FULL);
  const f = JSON.parse(fs.readFileSync(file, 'utf8'));
  const payload = sync.buildSyncPayload(f.judgments, new Date('2026-11-10T00:00:00Z'));
  const text = JSON.stringify(payload);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.judgments[0].judgmentId, 'J1');
  assert.ok(!text.includes('上訴駁回'), '不得含判決全文');
  assert.equal(sync.syncStatus().available, false);
  await assert.rejects(sync.notConfiguredBackend.push(payload), /尚未設定/);
});
