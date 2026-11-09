// 查詢流程（issue #4）：保留部分結果、重試上限、語意不清的選項、逐項容錯、流程說明、AI 提議關鍵字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newTrace, runQueryRounds, explainTrace, settleEach, buildClarifyOptions, MANUAL_OPTION, proposeQueries, analyzeCase,
} from '../../dist/index.js';

const hit = (id) => ({ id, title: `判決 ${id}` });

test('runQueryRounds：第一輪有結果就放行，並保留命中', async () => {
  const trace = newTrace('判決列表');
  const r = await runQueryRounds({
    feature: '判決搜尋', trace, module: 'rule', initialQueries: ['侵權'], maxRounds: 3,
    search: async () => [hit('a'), hit('b')],
    keyOf: (x) => x.id,
    propose: async () => { throw new Error('不應呼叫'); },
  });
  assert.equal(r.status, 'done');
  assert.equal(r.items.length, 2);
  assert.equal(trace.steps[0].decision, 'pass');
});

test('runQueryRounds：不合不是全棄，第一輪的部分結果會保留到第二輪之後', async () => {
  const trace = newTrace('判決列表');
  const table = { 侵權: [hit('a')], 侵害: [hit('b'), hit('a')] };
  const r = await runQueryRounds({
    feature: '判決搜尋', trace, module: 'cloud', initialQueries: ['侵權'], maxRounds: 3,
    sufficient: (items) => items.length >= 2,
    search: async (q) => table[q] ?? [],
    keyOf: (x) => x.id,
    propose: async () => ({ unclear: false, queries: ['侵害'], reason: '同義詞' }),
  });
  assert.equal(r.status, 'done');
  assert.deepEqual(r.items.map((x) => x.id).sort(), ['a', 'b']);
  assert.equal(trace.steps.length, 2);
  assert.equal(trace.steps[0].decision, 'retry');
  assert.equal(trace.steps[1].decision, 'pass');
});

test('runQueryRounds：達到重試上限時輸出現有結果並給建議，不無限重試', async () => {
  let calls = 0;
  const trace = newTrace('判決列表');
  const r = await runQueryRounds({
    feature: '判決搜尋', trace, module: 'ai', initialQueries: ['甲'], maxRounds: 2,
    sufficient: (items) => items.length >= 2,
    search: async (q) => { calls++; return q === '甲' ? [hit('x')] : []; },
    keyOf: (x) => x.id,
    propose: async () => ({ unclear: false, queries: ['乙'], reason: '' }),
  });
  assert.equal(r.status, 'capped');
  assert.equal(r.items.length, 1);
  assert.match(r.advice, /保留 1 筆/);
  assert.equal(calls, 2);
  assert.equal(trace.steps.at(-1).decision, 'capped');
});

test('runQueryRounds：語意不清時停下來詢問，選項最後一個是自行更正', async () => {
  const trace = newTrace('範圍整理');
  const r = await runQueryRounds({
    feature: '判決搜尋', trace, module: 'ai', initialQueries: ['個資'], maxRounds: 3,
    search: async () => [],
    keyOf: (x) => x.id,
    propose: async () => ({ unclear: true, question: '您指的是民事還是行政？', options: buildClarifyOptions([{ label: '民事', description: '民事侵權' }, { label: '行政', description: '行政罰' }]) }),
  });
  assert.equal(r.status, 'ask');
  assert.equal(r.question, '您指的是民事還是行政？');
  assert.equal(r.options.at(-1).id, MANUAL_OPTION.id);
  assert.equal(trace.steps.at(-1).decision, 'ask');
});

test('runQueryRounds：單一關鍵字失敗只記錄，不中止', async () => {
  const errors = [];
  const r = await runQueryRounds({
    feature: '判決搜尋', trace: newTrace('x'), module: 'rule', initialQueries: ['壞', '好'], maxRounds: 1,
    search: async (q) => { if (q === '壞') throw new Error('風控'); return [hit('ok')]; },
    keyOf: (x) => x.id,
    onError: (q) => errors.push(q),
    propose: async () => { throw new Error('不應呼叫'); },
  });
  assert.equal(r.status, 'done');
  assert.deepEqual(errors, ['壞']);
  assert.equal(r.items.length, 1);
});

test('settleEach：單一項目失敗時其他項目照常完成', async () => {
  const r = await settleEach([1, 2, 3], async (n) => { if (n === 2) throw new Error('逐案失敗'); return n * 10; });
  assert.deepEqual(r.results, [10, 30]);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].item, 2);
  assert.equal(r.failures[0].message, '逐案失敗');
});

test('explainTrace：每一步都有說明，且最後說明放行或達上限的原因', () => {
  const trace = newTrace('範圍整理');
  trace.steps.push({ stage: '第 1 輪判決搜尋', module: 'cloud', input: '民法', output: '3 筆', decision: 'pass', reason: '已有結果' });
  const ex = explainTrace(trace);
  assert.equal(ex.title, '範圍整理：處理流程說明');
  assert.equal(ex.paragraphs.length, 2);
  assert.match(ex.paragraphs[0], /雲端 AI.*放行到下一步/);
  assert.match(ex.paragraphs[1], /放行生成結果/);
});

test('proposeQueries：AI 回傳 unclear 時轉為選項，最後一個是自行更正', async () => {
  const ai = async () => JSON.stringify({ unclear: true, question: '請選擇', candidates: [{ label: '民事', description: 'a' }] });
  const p = await proposeQueries(ai, { request: '隱私', tried: ['隱私'], keptCount: 0, round: 1 });
  assert.equal(p.unclear, true);
  assert.equal(p.options.at(-1).id, 'manual');
});

test('proposeQueries：AI 提議的關鍵字會被截到 3 組', async () => {
  const ai = async () => '```json\n{"unclear":false,"queries":["a","b","c","d"],"reason":"r"}\n```';
  const p = await proposeQueries(ai, { request: 'x', tried: [], keptCount: 0, round: 1 });
  assert.deepEqual(p.queries, ['a', 'b', 'c']);
});

test('analyzeCase：提供現行條文時會放進提示詞', async () => {
  let seen = '';
  const ai = async (_s, user) => { seen = user; return JSON.stringify({ issue: 'i', holding: 'h', statuteApplication: 's', outcome: 'o', group: 'g' }); };
  const row = { id: 'T1', citedArticles: ['第 184 條'], lawNotes: [] };
  const d = { meta: { title: '臺灣高等法院 115 年度上字第 1 號' }, historyPosition: null, sections: {}, fullText: '本文' };
  const out = await analyzeCase(ai, '民法', row, d, { currentText: '第 184 條 因故意或過失…' });
  assert.match(seen, /法規現行條文/);
  assert.match(seen, /因故意或過失/);
  assert.equal(out.issue, 'i');
});
