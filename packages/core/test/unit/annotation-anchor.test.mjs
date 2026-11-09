// 個案研究筆記（issue #6）：文字區段標注的純函式測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeAnnotation, anchorStatus, reanchor, mergeRanges, segmentText, updateAnnotation, removeAnnotation, noteList, textHash, overlaps,
} from '../../dist/index.js';

const FULL = '主文：被告無罪。\n事實：被告於民國一百十年一月一日在臺北市某處持刀恐嚇告訴人。\n理由：本院認為被告之行為構成恐嚇危害安全罪。';
const T1 = new Date('2026-11-10T01:00:00Z');

test('建立標注：取得引用文字與全文雜湊，區段錯誤時拋錯', () => {
  const start = FULL.indexOf('持刀恐嚇');
  const a = makeAnnotation({ judgmentId: 'J1', start, end: start + 4, color: 'yellow', mode: 'highlight' }, FULL, T1);
  assert.equal(a.quote, '持刀恐嚇');
  assert.equal(a.textHash, textHash(FULL));
  assert.equal(a.note, '');
  assert.throws(() => makeAnnotation({ judgmentId: 'J1', start: -1, end: 3, color: 'yellow', mode: 'highlight' }, FULL), /超出/);
  assert.throws(() => makeAnnotation({ judgmentId: 'J1', start: 5, end: 5, color: 'yellow', mode: 'highlight' }, FULL), /超出/);
  assert.throws(() => makeAnnotation({ judgmentId: 'J1', start: 0, end: FULL.length + 1, color: 'yellow', mode: 'highlight' }, FULL), /超出/);
  assert.throws(() => makeAnnotation({ judgmentId: 'J1', start: 0, end: 4, color: 'red', mode: 'highlight' }, FULL), /螢光顏色/);
});

test('空白區段不可建立標注；單句註解模式才保留註解文字', () => {
  assert.throws(() => makeAnnotation({ judgmentId: 'J1', start: 2, end: 3, color: 'green', mode: 'highlight' }, '主文\n  \n'), /有文字/);
  const a = makeAnnotation({ judgmentId: 'J1', start: 0, end: 2, color: 'green', mode: 'highlight', note: '  不要保留  ' }, FULL, T1);
  assert.equal(a.note, '');
  const b = makeAnnotation({ judgmentId: 'J1', start: 0, end: 2, color: 'green', mode: 'highlight_note', note: '  重要  ' }, FULL, T1);
  assert.equal(b.note, '重要');
});

test('版本不符即標示需重新對位，不靜默錯位', () => {
  const start = FULL.indexOf('被告無罪');
  const a = makeAnnotation({ judgmentId: 'J1', start, end: start + 4, color: 'pink', mode: 'highlight' }, FULL, T1);
  assert.equal(anchorStatus(a, FULL), 'ok');
  const changed = FULL.replace('一月一日', '二月二日');
  assert.equal(anchorStatus(a, changed), 'needs_reanchor');
});

test('重新對位：引用文字唯一出現時更新位置與雜湊；多次出現或找不到則不猜', () => {
  const start = FULL.indexOf('持刀恐嚇');
  const a = makeAnnotation({ judgmentId: 'J1', start, end: start + 4, color: 'blue', mode: 'highlight' }, FULL, T1);
  const shifted = '前言新增一段。\n' + FULL;
  const r = reanchor(a, shifted, T1);
  assert.ok(r);
  assert.equal(shifted.slice(r.start, r.end), '持刀恐嚇');
  assert.equal(anchorStatus(r, shifted), 'ok');
  assert.equal(reanchor(a, FULL + '\n又一次持刀恐嚇'), null, '出現多次時不猜');
  assert.equal(reanchor(a, '完全不同的文字'), null, '找不到時回傳 null');
});

test('區段重疊判斷（半開區間）與合併', () => {
  assert.equal(overlaps({ start: 0, end: 5 }, { start: 5, end: 9 }), false);
  assert.equal(overlaps({ start: 0, end: 6 }, { start: 5, end: 9 }), true);
  assert.deepEqual(mergeRanges([{ start: 10, end: 12 }, { start: 0, end: 4 }, { start: 3, end: 6 }, { start: 12, end: 14 }]), [
    { start: 0, end: 6 },
    { start: 10, end: 14 },
  ]);
});

test('分段：重疊標注以較新建立的顏色為準，並保留所有覆蓋的標注 id', () => {
  const text = '甲乙丙丁戊';
  const older = makeAnnotation({ judgmentId: 'J', start: 0, end: 3, color: 'yellow', mode: 'highlight' }, text, new Date('2026-01-01T00:00:00Z'));
  const newer = makeAnnotation({ judgmentId: 'J', start: 1, end: 4, color: 'green', mode: 'highlight' }, text, new Date('2026-02-01T00:00:00Z'));
  const segs = segmentText(text, [newer, older]);
  assert.deepEqual(segs.map((s) => s.text), ['甲', '乙丙', '丁', '戊']);
  assert.equal(segs[0].color, 'yellow');
  assert.equal(segs[1].color, 'green');
  assert.deepEqual(segs[1].annotationIds, [older.id, newer.id]);
  assert.equal(segs[3].color, null);
  assert.equal(segs.map((s) => s.text).join(''), text, '分段後文字完整還原');
});

test('分段會略過需重新對位（範圍已超出新全文）的標注', () => {
  const a = makeAnnotation({ judgmentId: 'J', start: 0, end: 4, color: 'pink', mode: 'highlight' }, FULL, T1);
  const segs = segmentText('短', [a]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].color, null);
});

test('更新顏色與註解；切回只畫螢光時清空註解；刪除', () => {
  const a = makeAnnotation({ judgmentId: 'J', start: 0, end: 4, color: 'yellow', mode: 'highlight_note', note: '第一版' }, FULL, T1);
  let items = updateAnnotation([a], a.id, { color: 'blue', note: '  修訂  ' }, T1);
  assert.equal(items[0].color, 'blue');
  assert.equal(items[0].note, '修訂');
  items = updateAnnotation(items, a.id, { mode: 'highlight' }, T1);
  assert.equal(items[0].note, '');
  assert.throws(() => updateAnnotation(items, a.id, { color: 'red' }, T1), /螢光顏色/);
  assert.equal(removeAnnotation(items, a.id).length, 0);
});

test('註解列表只含有註解文字的標注，依位置排序', () => {
  const x = makeAnnotation({ judgmentId: 'J', start: 20, end: 24, color: 'yellow', mode: 'highlight_note', note: '後' }, FULL, T1);
  const y = makeAnnotation({ judgmentId: 'J', start: 0, end: 4, color: 'yellow', mode: 'highlight_note', note: '前' }, FULL, T1);
  const z = makeAnnotation({ judgmentId: 'J', start: 5, end: 9, color: 'green', mode: 'highlight' }, FULL, T1);
  assert.deepEqual(noteList([x, z, y]).map((a) => a.note), ['前', '後']);
});
