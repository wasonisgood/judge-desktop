// 條號與引用解析的測試案例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberFromText, normalizeArticleNo, parseCitations, parseSingleCitation, itemNumberOf } from '../../dist/index.js';

test('numberFromText：中文與阿拉伯數字', () => {
  assert.equal(numberFromText('一'), 1);
  assert.equal(numberFromText('十'), 10);
  assert.equal(numberFromText('十五'), 15);
  assert.equal(numberFromText('二十一'), 21);
  assert.equal(numberFromText('一百零五'), 105);
  assert.equal(numberFromText('一百八十四'), 184);
  assert.equal(numberFromText('184'), 184);
  assert.equal(numberFromText('１８４'), 184);
  assert.equal(numberFromText('abc'), null);
  assert.equal(numberFromText(''), null);
});

test('normalizeArticleNo：枝節條號與各種寫法', () => {
  assert.equal(normalizeArticleNo('第一百八十四條'), '184');
  assert.equal(normalizeArticleNo('第一百八十四條之一'), '184-1');
  assert.equal(normalizeArticleNo('第 191-3 條'), '191-3');
  assert.equal(normalizeArticleNo('第15條之1'), '15-1');
  assert.equal(normalizeArticleNo('15-1'), '15-1');
  assert.equal(normalizeArticleNo('第 15-1 條'), '15-1');
  assert.equal(normalizeArticleNo('第十四條之一之二'), '14-1-2');
  assert.equal(normalizeArticleNo('無條號'), null);
});

test('parseCitations：條、項、款都要精確解析', () => {
  const [a] = parseCitations('民法第184條第1項第2款');
  assert.equal(a.article, '184');
  assert.equal(a.paragraph, 1);
  assert.equal(a.item, 2);

  const [b] = parseCitations('國家賠償法第二條第三項');
  assert.equal(b.article, '2');
  assert.equal(b.paragraph, 3);
  assert.equal(b.item, undefined);

  const [c] = parseCitations('依民法第一百八十四條之一第二項規定');
  assert.equal(c.article, '184-1');
  assert.equal(c.paragraph, 2);

  const [d] = parseCitations('第 191-3 條');
  assert.equal(d.article, '191-3');
  assert.equal(d.paragraph, undefined);
});

test('parseCitations：一段文字含多條引用', () => {
  const refs = parseCitations('按民法第184條第1項前段、第191條之3及國家賠償法第2條第2項。');
  assert.deepEqual(refs.map((r) => r.article), ['184', '191-3', '2']);
  assert.equal(refs[0].paragraph, 1);
  assert.equal(refs[2].paragraph, 2);
});

test('parseSingleCitation：使用者輸入取第一條', () => {
  const r = parseSingleCitation('民法第 15-2 條第 1 項第 3 款');
  assert.equal(r.article, '15-2');
  assert.equal(r.paragraph, 1);
  assert.equal(r.item, 3);
  assert.equal(parseSingleCitation('沒有條文'), null);
});

test('itemNumberOf：款號', () => {
  assert.equal(itemNumberOf('一、為獨資營業。'), 1);
  assert.equal(itemNumberOf('十二、其他。'), 12);
  assert.equal(itemNumberOf('第一項'), null);
});
