// 實際連線測試：需要網路。以「戒嚴」查詢，確認列表與內頁都能解析。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchJudgments, getJudgmentDetail } from '../dist/index.js';

test('live: keyword search returns list items with ids', { timeout: 120000 }, async () => {
  const items = await searchJudgments('戒嚴', { maxItems: 3 });
  assert.ok(items.length > 0, '列表應有結果');
  assert.match(items[0].id, /^[A-Z]+/);
  console.log('first:', items[0]);
});

test('live: detail parses meta and full text', { timeout: 120000 }, async () => {
  const [first] = await searchJudgments('戒嚴', { maxItems: 1 });
  const d = await getJudgmentDetail(first.id);
  assert.ok(d.fullText.length > 30, '全文應有內容');
  assert.ok(d.meta.title.length > 0, '應有裁判字號');
  console.log('title:', d.meta.title, '| sections:', Object.keys(d.sections));
});
