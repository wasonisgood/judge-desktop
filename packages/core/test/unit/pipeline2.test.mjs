// issue #4 補齊項目：搜尋預算（上限、保留、失敗記錄）、法規上下文（現行條文與沿革）、AI 提示詞讀入法規內容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchBudget, runBudgetedSearch, remainingSearches, buildLawContext, LAW_CONTEXT_MAX_CHARS,
  proposeQueries, briefJudgment,
} from '../../dist/index.js';

const hit = (id) => ({ id });

test('runBudgetedSearch：達上限後不再搜尋，且回報已保留的結果', async () => {
  const b = createSearchBudget(2);
  let calls = 0;
  const search = async (q) => { calls++; return q === 'a' ? [hit('1')] : []; };
  const keyOf = (x) => x.id;
  await runBudgetedSearch(b, ['a'], search, keyOf);
  const second = await runBudgetedSearch(b, ['b'], search, keyOf);
  assert.equal(second.remaining, 0);
  const third = await runBudgetedSearch(b, ['c'], search, keyOf);
  assert.equal(third.status, 'capped');
  assert.equal(calls, 2);
  assert.equal(third.items.length, 1);
  assert.match(third.message, /已達搜尋上限/);
  assert.match(third.message, /詢問使用者/);
});

test('runBudgetedSearch：跨次累計結果，不因後續搜尋而丟掉先前的命中', async () => {
  const b = createSearchBudget(3);
  const table = { 甲: [hit('1'), hit('2')], 乙: [hit('2'), hit('3')] };
  const keyOf = (x) => x.id;
  await runBudgetedSearch(b, ['甲'], async (q) => table[q], keyOf);
  const r = await runBudgetedSearch(b, ['乙'], async (q) => table[q], keyOf);
  assert.deepEqual(r.items.map((x) => x.id).sort(), ['1', '2', '3']);
  assert.equal(remainingSearches(b), 1);
});

test('runBudgetedSearch：單一關鍵字失敗只記錄，其餘照常', async () => {
  const b = createSearchBudget(3);
  const errors = [];
  const r = await runBudgetedSearch(
    b, ['壞', '好'],
    async (q) => { if (q === '壞') throw new Error('風控'); return [hit('ok')]; },
    (x) => x.id,
    (q) => errors.push(q),
  );
  assert.deepEqual(errors, ['壞']);
  assert.equal(r.items.length, 1);
  assert.match(r.message, /失敗：壞/);
});

test('runBudgetedSearch：已嘗試過的關鍵字不重複搜尋，也不消耗次數', async () => {
  const b = createSearchBudget(3);
  let calls = 0;
  const search = async () => { calls++; return []; };
  await runBudgetedSearch(b, ['x'], search, (x) => x.id);
  const again = await runBudgetedSearch(b, ['x'], search, (x) => x.id);
  assert.equal(again.status, 'no_new_query');
  assert.equal(calls, 1);
  assert.equal(remainingSearches(b), 2);
});

test('buildLawContext：有引用條文時只取引用條文的現行內容，並附沿革提示', () => {
  const law = {
    pcode: 'B0000001', name: '國家賠償法',
    articles: [
      { article: '2', noText: '第 2 條', paragraphs: [{ no: 1, text: '公務員於執行職務時，故意或過失不法侵害人民自由或權利者，國家應負賠償責任。', items: [] }] },
      { article: '3', noText: '第 3 條', paragraphs: [{ no: 1, text: '其他條文。', items: [] }] },
    ],
  };
  const history = [{
    article: '2', noText: '第 2 條',
    versions: [
      { date: '1980-06-20', kind: '制定', text: '舊文', reason: '' },
      { date: '2000-01-01', kind: '修正', text: '新文', reason: '' },
    ],
  }];
  const ctx = buildLawContext({ statuteName: '國家賠償法', law, history, cited: ['國家賠償法第2條'] });
  assert.match(ctx.text, /引用條文的現行內容/);
  assert.match(ctx.text, /故意或過失/);
  assert.doesNotMatch(ctx.text, /其他條文/);
  assert.equal(ctx.notes.length, 0);
});

test('buildLawContext：現行條文或沿革取得失敗時，明確記錄，不編造', () => {
  const ctx = buildLawContext({ statuteName: '某法', law: null, history: [], cited: [] });
  assert.match(ctx.text, /法規：某法/);
  assert.equal(ctx.notes.length, 2);
  assert.match(ctx.notes[0], /現行條文未取得/);
  assert.match(ctx.notes[1], /沿革未取得/);
});

test('buildLawContext：輸出有字數上限', () => {
  const long = '條文'.repeat(5000);
  const law = { pcode: 'x', name: 'x', articles: [{ article: '1', noText: '第 1 條', paragraphs: [{ no: 1, text: long, items: [] }] }] };
  const ctx = buildLawContext({ statuteName: 'x', law, history: [], cited: ['x第1條'] });
  assert.ok(ctx.text.length <= LAW_CONTEXT_MAX_CHARS + 1);
});

test('proposeQueries：法規上下文會放進提示詞', async () => {
  let seen = '';
  const ai = async (_s, user) => { seen = user; return '{"unclear":false,"queries":["補償"],"reason":"r"}'; };
  await proposeQueries(ai, { request: '戒嚴補償', tried: [], keptCount: 0, round: 1, lawContext: '法規：國家賠償法\n現行內容XYZ' });
  assert.match(seen, /相關法規內容/);
  assert.match(seen, /現行內容XYZ/);
});

test('briefJudgment：法規上下文會放進提示詞', async () => {
  let seen = '';
  const ai = async (_s, user) => { seen = user; return JSON.stringify({ title: 't', sections: [{ heading: '一', paragraphs: ['p'], evidence: [] }] }); };
  const d = { meta: { title: 'T', court: '', dateIso: '2020-01-01', cause: '' }, historyPosition: null, sections: {}, fullText: '本文內容' };
  await briefJudgment(ai, d, { focus: '', length: '短', fields: [{ name: '一' }], lawContext: '法規：民法\n第184條現行內容QQQ' });
  assert.match(seen, /判決引用法規的現行條文/);
  assert.match(seen, /QQQ/);
});
