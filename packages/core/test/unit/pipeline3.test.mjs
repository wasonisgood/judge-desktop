// v3.6.0：取消、提議失敗不吃掉結果、進度例外不影響流程、友善錯誤訊息。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newTrace, runQueryRounds, settleEach, friendlyError, raceAbort, JobCancelledError, isCancelError,
} from '../../dist/index.js';

const hit = (id) => ({ id });

test('settleEach：取消後停止，回傳取消前已完成的結果', async () => {
  const ac = new AbortController();
  const r = await settleEach([1, 2, 3, 4], async (n) => { if (n === 2) ac.abort(); return n * 10; }, undefined, ac.signal);
  assert.equal(r.cancelled, true);
  assert.deepEqual(r.results, [10, 20]);
});

test('settleEach：進度回報拋例外時，處理照常完成', async () => {
  const r = await settleEach([1, 2], async (n) => n, () => { throw new Error('視窗已關閉'); });
  assert.deepEqual(r.results, [1, 2]);
  assert.equal(r.cancelled, false);
});

test('runQueryRounds：AI 提議失敗時保留已找到的結果，並記錄原因', async () => {
  const errors = [];
  const trace = newTrace('判決列表');
  const r = await runQueryRounds({
    feature: '判決搜尋', trace, module: 'ai', initialQueries: ['甲'], maxRounds: 3,
    sufficient: (items) => items.length >= 5,
    search: async () => [hit('a')],
    keyOf: (x) => x.id,
    propose: async () => { throw new Error('AI 額度不足'); },
    onProposeError: (e) => errors.push(e.message),
  });
  assert.equal(r.status, 'capped');
  assert.equal(r.items.length, 1);
  assert.deepEqual(errors, ['AI 額度不足']);
  assert.match(trace.steps.at(-1).reason, /額度/);
});

test('runQueryRounds：取消時回傳 cancelled 與已保留的結果', async () => {
  const ac = new AbortController();
  const r = await runQueryRounds({
    feature: '判決搜尋', trace: newTrace('x'), module: 'rule', initialQueries: ['甲', '乙'], maxRounds: 2,
    signal: ac.signal,
    search: async (q) => { if (q === '甲') { ac.abort(); return [hit('a')]; } return [hit('b')]; },
    keyOf: (x) => x.id,
    propose: async () => ({ unclear: false, queries: [], reason: '' }),
  });
  assert.equal(r.status, 'cancelled');
  assert.deepEqual(r.items.map((x) => x.id), ['a']);
});

test('raceAbort：訊號觸發時立即拒絕，底層 Promise 完成後不影響結果', async () => {
  const ac = new AbortController();
  const slow = new Promise((r) => setTimeout(() => r('late'), 50));
  const p = raceAbort(slow, ac.signal);
  ac.abort();
  await assert.rejects(p, (e) => e instanceof JobCancelledError && isCancelError(e));
});

test('friendlyError：逾時、額度、金鑰、頻繁、網路各有中文說明', () => {
  assert.match(friendlyError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })).message, /逾時/);
  assert.match(friendlyError(new Error('AI 服務回傳 402：insufficient_quota')).message, /額度/);
  assert.match(friendlyError(new Error('AI 服務回傳 401：invalid api key')).message, /金鑰/);
  assert.equal(friendlyError(new Error('HTTP 429 too many requests')).retryable, true);
  assert.match(friendlyError(Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' })).message, /網路/);
  assert.equal(friendlyError(new Error('其他錯誤')).message, '其他錯誤');
});
