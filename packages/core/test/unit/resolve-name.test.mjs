// 法名確認的純函式測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, similarity, queryVariants } from '../../dist/index.js';

test('編輯距離以字元計算（支援中文）', () => {
  assert.equal(editDistance('國家賠償法', '國家賠償法'), 0);
  assert.equal(editDistance('證券投資信託及投資顧問法', '證券投資信託及顧問法'), 2);
  assert.equal(editDistance('', '法'), 1);
});

test('相似度：完全相同為 1，差異越大越低', () => {
  assert.equal(similarity('國家賠償法', '國家賠償法'), 1);
  assert.ok(similarity('證券投資信託及投資顧問法', '證券投資信託及顧問法') >= 0.8);
  assert.ok(similarity('證券投資信託及投資顧問法', '國家賠償法') < 0.4);
});

test('查詢變體：原字串、去「及」、前段關鍵詞，去重', () => {
  const v = queryVariants('證券投資信託及投資顧問法');
  assert.ok(v.includes('證券投資信託及投資顧問法'));
  assert.ok(v.includes('證券投資信託投資顧問法'));
  assert.ok(v.includes('證券投資信託'));
  assert.equal(new Set(v).size, v.length);
});

test('清理法名：去括號、去「第 N 條」之後的條文、去符號', async () => {
  const { cleanLawQuery } = await import('../../dist/index.js');
  assert.equal(cleanLawQuery('國家賠償法第2條'), '國家賠償法');
  assert.equal(cleanLawQuery('國家賠償法（第2條）'), '國家賠償法');
  assert.equal(cleanLawQuery('國家賠償法/施行細則'), '國家賠償法施行細則');
  assert.equal(cleanLawQuery('國家賠償法&'), '國家賠償法');
  assert.equal(cleanLawQuery(' 國家賠償法 '), '國家賠償法');
});
