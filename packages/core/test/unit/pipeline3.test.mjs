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

// v3.6.1：範圍整理繼承快取（搜尋與內頁走注入的來源，不直接連司法院）
test('buildScopeTable：搜尋與內頁走注入的來源（可繼承快取），不呼叫司法院', async () => {
  const { buildScopeTable } = await import('../../dist/index.js');
  const searched = [];
  const fetched = [];
  const detail = (id) => ({
    id, meta: { title: `判決${id}`, court: '臺灣高等法院', dateIso: '2020-01-01', cause: '損害賠償', sourceUrl: 'x' },
    sections: { 主文: '駁回。' }, fullText: '依民法第184條規定，請求損害賠償。', relatedLaws: ['民法第184條'], historyPosition: null,
  });
  const rows = await buildScopeTable({
    statute: '民法', maxItems: 5,
    searchSource: async (q, max) => { searched.push([q, max]); return [{ id: 'A1', title: '判決A1', dateIso: '2020-01-01', cause: '' }]; },
    detailSource: async (id) => { fetched.push(id); return detail(id); },
  });
  assert.deepEqual(searched, [['民法', 10]]);
  assert.deepEqual(fetched, ['A1']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'A1');
});

// v3.7.0：聯盟設定格式檢查
test('checkFederationFields：完整且格式正確時沒有問題；缺漏或格式錯誤會逐項指出', async () => {
  const { checkFederationFields } = await import('../../dist/index.js');
  const ok = { organizationId: '8c5aaae2-1c0c-4f73-94f8-a8b8d4b6a015', federationRuleId: 'fdrl_01ANPAQtu52UgHvcadQJYGe7', serviceAccountId: 'svac_01CjPwckkun6xbYvckPh2e91', workspaceId: '', identitySource: 'provider', identityTokenFile: '' };
  assert.deepEqual(checkFederationFields(ok), []);
  const bad = checkFederationFields({ ...ok, organizationId: 'abc', federationRuleId: 'rule1', serviceAccountId: '', workspaceId: 'x' });
  assert.deepEqual(bad.map((p) => p.field).sort(), ['federationRuleId', 'organizationId', 'serviceAccountId', 'workspaceId'].sort());
});

test('checkFederationFields：自備檔案模式必須有檔案路徑', async () => {
  const { checkFederationFields } = await import('../../dist/index.js');
  const f = { organizationId: '8c5aaae2-1c0c-4f73-94f8-a8b8d4b6a015', federationRuleId: 'fdrl_a', serviceAccountId: 'svac_a', workspaceId: '', identitySource: 'file', identityTokenFile: '' };
  assert.deepEqual(checkFederationFields(f).map((p) => p.field), ['identityTokenFile']);
});
