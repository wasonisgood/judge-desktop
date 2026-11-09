// 內建模組的增量同步計畫：首次安裝、已是最新、只複製變動檔案、刪除已移除的檔案。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBundleSync } from '../../dist/index.js';

test('首次安裝：沒有任何本機紀錄時，全部內建檔案都要複製', () => {
  const p = planBundleSync('1.0.0', { 'rules.json': 'a', 'endpoints.json': 'b' }, null);
  assert.equal(p.firstInstall, true);
  assert.equal(p.upToDate, false);
  assert.deepEqual(p.copy.sort(), ['endpoints.json', 'rules.json']);
});

test('已是最新：版本與雜湊都相同時不做任何動作', () => {
  const p = planBundleSync('1.0.0', { 'rules.json': 'a' }, { version: '1.0.0', files: { 'rules.json': 'a' } });
  assert.equal(p.upToDate, true);
  assert.deepEqual(p.copy, []);
  assert.deepEqual(p.remove, []);
});

test('增量：只複製雜湊改變或新增的檔案，未改變的不動', () => {
  const p = planBundleSync('1.1.0', { 'rules.json': 'NEW', 'endpoints.json': 'same', 'new.json': 'x' },
    { version: '1.0.0', files: { 'rules.json': 'OLD', 'endpoints.json': 'same' } });
  assert.equal(p.upToDate, false);
  assert.equal(p.firstInstall, false);
  assert.deepEqual(p.copy.sort(), ['new.json', 'rules.json']);
  assert.ok(!p.copy.includes('endpoints.json'));
});

test('內建已移除的檔案要從本機刪除', () => {
  const p = planBundleSync('1.1.0', { 'rules.json': 'a' }, { version: '1.0.0', files: { 'rules.json': 'a', 'old.json': 'z' } });
  assert.deepEqual(p.remove, ['old.json']);
  assert.equal(p.upToDate, false);
});

test('版本變了但檔案相同：仍視為需要更新紀錄（不複製檔案）', () => {
  const p = planBundleSync('1.1.0', { 'rules.json': 'a' }, { version: '1.0.0', files: { 'rules.json': 'a' } });
  assert.equal(p.upToDate, false);
  assert.deepEqual(p.copy, []);
});
