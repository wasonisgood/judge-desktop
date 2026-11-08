// 現行法規（法務部全國法規資料庫）HTML 解析測試。樣本：民法全文頁（test/fixtures/moj_minfa_all.html）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCurrentLawHtml, currentArticleText } from '../../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'fixtures', 'moj_minfa_all.html'), 'utf8');
const law = parseCurrentLawHtml(html, 'B0000001');
const find = (no) => law.articles.find((a) => a.article === no);

test('解析出大量條文，條號標準化', () => {
  assert.ok(law.articles.length > 1000, `條文數應超過 1000，實際 ${law.articles.length}`);
  assert.ok(find('184'), '應有第 184 條');
  assert.ok(find('191-3'), '應有第 191-3 條（枝節條號）');
  assert.ok(find('15-2'), '應有第 15-2 條');
});

test('單一項的條文：一個項、沒有款', () => {
  const a = find('1');
  assert.equal(a.paragraphs.length, 1);
  assert.equal(a.paragraphs[0].items.length, 0);
  assert.match(a.paragraphs[0].text, /習慣/);
});

test('多項的條文：項依序編號', () => {
  const a = find('3');
  assert.equal(a.paragraphs.length, 3);
  assert.deepEqual(a.paragraphs.map((p) => p.no), [1, 2, 3]);
  assert.match(a.paragraphs[1].text, /用印章代簽名/);
});

test('款：第 15-2 條第 1 項底下有七款，款號由一至七', () => {
  const a = find('15-2');
  assert.equal(a.paragraphs[0].items.length, 7);
  assert.deepEqual(a.paragraphs[0].items.map((i) => i.no), [1, 2, 3, 4, 5, 6, 7]);
  assert.match(a.paragraphs[0].items[0].text, /^一、為獨資/);
  assert.equal(a.paragraphs.length, 4, '第 15-2 條應有四項');
});

test('款：第 22 條的兩款（住所視為居所的情形）', () => {
  const a = find('22');
  assert.equal(a.paragraphs[0].items.length, 2);
  assert.match(a.paragraphs[0].items[1].text, /^二、在我國無住所者。/);
});

test('currentArticleText：可精確取出某項或某款', () => {
  assert.match(currentArticleText(law, '15-2', 1, 3), /^三、為訴訟行為。$/);
  assert.match(currentArticleText(law, '15-2', 2), /第七十八條至第八十三條/);
  assert.equal(currentArticleText(law, '15-2', 1, 99), null, '不存在的款應回傳 null');
  assert.equal(currentArticleText(law, '999999'), null, '不存在的條應回傳 null');
});
