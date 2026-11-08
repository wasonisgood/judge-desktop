// 檔案管理的純函式測試：新增、封存、垃圾桶、還原、永久刪除、排序。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { addItem, updateItem, removeTrashed, listItems } = require('../dist/main/library.js');

const base = { kind: 'list', title: 't', summary: 's', payload: {} };

test('新增項目預設為使用中、未加星號，且排在最前', () => {
  let items = addItem([], base, new Date('2026-11-08T10:00:00Z'));
  items = addItem(items, { ...base, title: 'second' }, new Date('2026-11-08T11:00:00Z'));
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'second');
  assert.equal(items[0].status, 'active');
  assert.equal(items[0].starred, false);
  assert.ok(items[0].id.length > 4);
});

test('封存與移入垃圾桶只改狀態，不刪除資料', () => {
  let items = addItem([], base);
  const id = items[0].id;
  items = updateItem(items, id, { status: 'archived' });
  assert.equal(items[0].status, 'archived');
  items = updateItem(items, id, { status: 'trashed' });
  assert.equal(items.length, 1, '移入垃圾桶不應刪除');
});

test('只有垃圾桶中的項目可以永久刪除', () => {
  let items = addItem([], base);
  const id = items[0].id;
  const notTrashed = removeTrashed(items, id);
  assert.equal(notTrashed.removed, false, '使用中的項目不能直接刪除');
  items = updateItem(items, id, { status: 'trashed' });
  const r = removeTrashed(items, id);
  assert.equal(r.removed, true);
  assert.equal(r.items.length, 0);
});

test('列表依狀態篩選，星號項目排在前面', () => {
  let items = addItem([], { ...base, title: 'a' }, new Date('2026-11-08T10:00:00Z'));
  items = addItem(items, { ...base, title: 'b' }, new Date('2026-11-08T11:00:00Z'));
  items = updateItem(items, items.find((x) => x.title === 'b').id, { starred: true });
  const active = listItems(items, 'active');
  assert.equal(active[0].title, 'b', '有星號的項目應排最前');
  const a = items.find((x) => x.title === 'a');
  items = updateItem(items, a.id, { status: 'archived' });
  assert.deepEqual(listItems(items, 'active').map((x) => x.title), ['b']);
  assert.deepEqual(listItems(items, 'archived').map((x) => x.title), ['a']);
  assert.equal(listItems(items).length, 2);
});

test('還原：從垃圾桶改回使用中', () => {
  let items = addItem([], base);
  items = updateItem(items, items[0].id, { status: 'trashed' });
  items = updateItem(items, items[0].id, { status: 'active' });
  assert.equal(items[0].status, 'active');
});
