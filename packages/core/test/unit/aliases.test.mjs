// 判決名稱與縮寫整理測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJudgmentText, judgmentQueries } from '../../dist/index.js';

test('去除空白、台改臺', () => {
  assert.equal(normalizeJudgmentText(' 台北 地院 '), '臺北地院');
  assert.equal(normalizeJudgmentText('回復　原狀'), '回復原狀');
});

test('高院縮寫展開為臺灣高等法院，並保留原字串', () => {
  const q = judgmentQueries('高院 戒嚴');
  assert.ok(q.includes('臺灣高等法院戒嚴'));
  assert.ok(q.includes('高院戒嚴'));
});

test('沒有縮寫時只回傳整理後的字串', () => {
  assert.deepEqual(judgmentQueries('回復原狀'), ['回復原狀']);
  assert.deepEqual(judgmentQueries('  '), []);
});
