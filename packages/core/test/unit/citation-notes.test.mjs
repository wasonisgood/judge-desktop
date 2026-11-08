// 引用條文與期間內修法的對照測試（使用合成沿革資料）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationLawNotes, parseCitations } from '../../dist/index.js';

const history = [{
  article: '2',
  noText: '第二條',
  versions: [
    { date: '1980-06-20', kind: '制定', text: '甲項\n一、款甲', reason: '' },
    { date: '2010-05-01', kind: '修正', text: '甲項\n一、款甲改寫', reason: '' },
  ],
}];

test('引用條文：期間內修法且該款改變 → changed，列出修法日期', () => {
  const refs = parseCitations('國家賠償法第2條第1項第1款');
  const [n] = citationLawNotes(refs, history, { from: '2000-01-01', to: '2015-12-31' });
  assert.equal(n.status, 'changed');
  assert.deepEqual(n.changeDates, ['2010-05-01']);
  assert.match(n.summary, /2010-05-01/);
});

test('引用條文：期間內未修法 → unchanged', () => {
  const refs = parseCitations('第2條第1項');
  const [n] = citationLawNotes(refs, history, { from: '1981-01-01', to: '2005-12-31' });
  assert.equal(n.status, 'unchanged');
  assert.deepEqual(n.changeDates, []);
});

test('引用條文：沒有指定期間 → no_period，只列現行文字', () => {
  const [n] = citationLawNotes(parseCitations('第2條'), history);
  assert.equal(n.status, 'no_period');
});

test('引用條文：沿革中查無此條 → not_in_history，並提醒人工確認', () => {
  const [n] = citationLawNotes(parseCitations('第999條'), history, { from: '2000-01-01' });
  assert.equal(n.status, 'not_in_history');
  assert.match(n.summary, /查無此條/);
});

test('引用條文：一段文字多個引用，各自獨立判斷', () => {
  const notes = citationLawNotes(parseCitations('第2條第1項、第999條'), history, { from: '2000-01-01', to: '2015-12-31' });
  assert.deepEqual(notes.map((n) => n.status), ['changed', 'not_in_history']);
});
