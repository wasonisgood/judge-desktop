// 法名確認的實際連線測試：不完全正確的法名必須能找到正式法名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LawClient, createCurlFetch, resolveLawName } from '../dist/index.js';

test('live: 不完全正確的法名（證券投資信託及投資顧問法）自動找到正式法名', { timeout: 240000 }, async () => {
  const c = new LawClient({ fetchImpl: createCurlFetch() });
  const r = await resolveLawName(c, '證券投資信託及投資顧問法');
  assert.equal(r.status, 'auto', '應自動採用最接近的正式法名：' + JSON.stringify(r).slice(0, 200));
  assert.equal(r.match.name, '證券投資信託及顧問法');
  assert.equal(r.match.pcode, 'G0400121');
});

test('live: 完整正確的法名直接確認為 exact', { timeout: 240000 }, async () => {
  const c = new LawClient({ fetchImpl: createCurlFetch() });
  const r = await resolveLawName(c, '國家賠償法');
  assert.equal(r.status, 'exact');
});
