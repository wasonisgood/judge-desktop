// 判決列表 AI 篩選：解析、漏判視為不相關。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenRelevance } from '../../dist/index.js';

const items = [
  { id: 'a', title: '最高法院 115 年度台上字第 11 號民事裁定', cause: '請求解除董事職務', dateIso: '2026-08-19' },
  { id: 'b', title: '臺灣臺北地方法院 114 年度訴字第 5479 號民事判決', cause: '損害賠償', dateIso: '2026-08-14' },
  { id: 'c', title: '臺灣高等法院 115 年度非抗字第 57 號民事裁定', cause: '解除董事職務等', dateIso: '2026-08-11' },
];

test('AI 篩選：依回覆標示相關與理由', async () => {
  const ai = async () => JSON.stringify({ results: [
    { id: 'a', relevant: true, reason: '案由為解除董事職務' },
    { id: 'b', relevant: false, reason: '一般損害賠償，與主題無關' },
    { id: 'c', relevant: true, reason: '案由含解除董事職務' },
  ] });
  const r = await screenRelevance(ai, '金管會解除董事職務', items);
  assert.equal(r.a.relevant, true);
  assert.equal(r.b.relevant, false);
  assert.match(r.b.reason, /損害賠償/);
});

test('AI 篩選：漏掉的 id 一律視為不相關（不猜）', async () => {
  const ai = async () => JSON.stringify({ results: [{ id: 'a', relevant: true, reason: '相關' }] });
  const r = await screenRelevance(ai, '主題', items);
  assert.equal(r.c.relevant, false);
  assert.equal(r.c.reason, '未判定');
});

test('AI 篩選：回覆中出現不存在的 id 會被忽略', async () => {
  const ai = async () => JSON.stringify({ results: [{ id: 'zzz', relevant: true, reason: '亂寫' }] });
  const r = await screenRelevance(ai, '主題', items);
  assert.equal(Object.keys(r).length, 3);
  assert.equal(r.zzz, undefined);
});
