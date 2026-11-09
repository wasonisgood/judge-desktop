// 納入／排除標準的自動核查（issue #12）測試：程式判斷、AI 依據逐字驗證、決定、重新檢索建議、分開保存、規劃用量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCriteria, evaluateProgram, evaluateByAi, decide, summarizeRun, planRun, estimateCostUsd,
  runCriteria, appendRun, compareRuns, toCriteriaTable,
} from '../../dist/index.js';
import * as core from '../../dist/index.js';

const TEXT = '原告為消費者，於民國一百一十年向被告購買商品。被告未就此提起救濟，本案已確定。';

const program = (id, kind, keywords, keywordMode) => ({ id, kind, text: `${kind}-${id}`, method: 'program', keywords, keywordMode });
const ai = (id, kind) => ({ id, kind, text: `AI-${id}`, method: 'ai' });

test('標準設定驗證：至少一條、識別碼不重複、程式判斷需關鍵字', () => {
  assert.match(validateCriteria([]).join(), /至少/);
  assert.match(validateCriteria([program('a', 'include', ['消費者']), program('a', 'exclude', ['x'])]).join(), /重複/);
  assert.match(validateCriteria([program('a', 'include', [])]).join(), /關鍵字/);
  assert.deepEqual(validateCriteria([program('a', 'include', ['消費者']), ai('b', 'exclude')]), []);
});

test('程式判斷：any／all 模式；依據為原文逐字片段', () => {
  const any = evaluateProgram(program('a', 'include', ['消費者', '不存在的詞']), TEXT);
  assert.equal(any.verdict, 'met');
  const all = evaluateProgram(program('a', 'include', ['消費者', '不存在的詞'], 'all'), TEXT);
  assert.equal(all.verdict, 'not_met');
  for (const q of any.quotes) assert.ok(TEXT.includes(q), `依據必須是原文逐字片段：${q}`);
  const empty = evaluateProgram(program('a', 'include', ['消費者']), '');
  assert.equal(empty.verdict, 'unknown');
});

test('AI 判斷：依據逐字存在則採用', async () => {
  const fake = async () => JSON.stringify({ verdict: 'met', quotes: ['被告未就此提起救濟，本案已確定'], basis: '已確定' });
  const r = await evaluateByAi(fake, ai('f', 'exclude'), TEXT);
  assert.equal(r.verdict, 'met');
  assert.equal(r.invalidEvidence, false);
  assert.deepEqual(r.quotes, ['被告未就此提起救濟，本案已確定']);
});

test('AI 判斷：依據不在原文中（捏造）→ 視為無效並改為無法判斷', async () => {
  const fake = async () => JSON.stringify({ verdict: 'met', quotes: ['法院判處被告無期徒刑確定'], basis: '捏造' });
  const r = await evaluateByAi(fake, ai('f', 'include'), TEXT);
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.invalidEvidence, true);
  assert.deepEqual(r.quotes, []);
});

test('AI 判斷：回覆格式錯誤只影響這一條（無法判斷），不拋錯', async () => {
  const r = await evaluateByAi(async () => '我想應該是符合', ai('f', 'include'), TEXT);
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.invalidEvidence, false);
});

test('AI 服務錯誤（例如金鑰或額度）原樣拋出，不會被當成無法判斷', async () => {
  await assert.rejects(evaluateByAi(async () => { throw new Error('額度不足'); }, ai('f', 'include'), TEXT), /額度不足/);
});

test('決定：排除條件成立或納入條件不成立即排除；有無法判斷為待檢視；其餘納入', () => {
  const crit = [program('inc', 'include', ['消費者']), program('exc', 'exclude', ['上訴'])];
  const res = (id, verdict) => ({ criterionId: id, verdict, method: 'program', basis: '', quotes: [], invalidEvidence: false });
  assert.equal(decide(crit, [res('inc', 'met'), res('exc', 'not_met')]), 'include');
  assert.equal(decide(crit, [res('inc', 'met'), res('exc', 'met')]), 'exclude');
  assert.equal(decide(crit, [res('inc', 'not_met'), res('exc', 'not_met')]), 'exclude');
  assert.equal(decide(crit, [res('inc', 'unknown'), res('exc', 'not_met')]), 'review');
  assert.equal(decide(crit, [res('inc', 'unknown'), res('exc', 'met')]), 'exclude', '已確定排除時不需人工檢視');
});

const REVIEW_RUN = {
  query: '消費者 買賣',
  criteria: [{ id: 'c1', kind: 'include', text: '原告為消費者', method: 'ai' }],
  outcomes: [
    { id: '1', caseNo: '案1', dateIso: null, decision: 'review', results: [{ criterionId: 'c1', verdict: 'unknown', method: 'ai', basis: 'x', quotes: [], invalidEvidence: true }] },
    { id: '2', caseNo: '案2', dateIso: null, decision: 'include', results: [{ criterionId: 'c1', verdict: 'met', method: 'ai', basis: 'y', quotes: ['原告為消費者'], invalidEvidence: false }] },
  ],
  summary: { total: 2, include: 1, exclude: 0, review: 1, matchRate: 0.5, reviewRate: 0.5, invalidEvidenceCount: 1 },
};

test('重新檢索檢閱：沒有固定門檻；AI 看摘要後回覆 ok、或提出新查詢詞；無法判讀時明確回報 unclear', async () => {
  // 摘要內容會進入提示（候選數、各標準判定次數、無效依據），但不含判決全文。
  let seenUser = '';
  const ai = async (_s, user) => { seenUser = user; return '{"ok":true}'; };
  const okReview = await core.reviewRerun(ai, REVIEW_RUN, new Date('2026-01-01T00:00:00Z'));
  assert.equal(okReview.verdict, 'ok');
  assert.equal(okReview.reviewedAt, '2026-01-01T00:00:00.000Z');
  assert.match(seenUser, /候選 2 筆/);
  assert.match(seenUser, /無效依據 1/);
  assert.match(seenUser, /符合 1、不符合 0、無法判斷 1/);

  const rerun = await core.reviewRerun(async () => '{"ok":false,"query":"網購 退貨 消費者保護法","reason":"多數與標準無關"}', REVIEW_RUN);
  assert.deepEqual([rerun.verdict, rerun.query, rerun.reason], ['rerun', '網購 退貨 消費者保護法', '多數與標準無關']);

  const noQuery = await core.reviewRerun(async () => '{"ok":false}', REVIEW_RUN);
  assert.equal(noQuery.verdict, 'rerun');
  assert.equal(noQuery.query, undefined);

  const garbled = await core.reviewRerun(async () => '不是 JSON', REVIEW_RUN);
  assert.equal(garbled.verdict, 'unclear');
  assert.match(garbled.reason, /無法判讀/);
});

test('重新檢索檢閱：AI 服務錯誤原樣拋出，不靜默決定', async () => {
  await assert.rejects(core.reviewRerun(async () => { throw new Error('額度不足'); }, REVIEW_RUN), /額度不足/);
});

test('重新檢索檢閱：沒有固定門檻（舊的納入率／無法判斷率門檻已移除）', () => {
  assert.equal(core.rerunSuggestion, undefined);
  assert.equal(core.DEFAULT_RERUN_THRESHOLDS, undefined);
});

const CASES = [
  { id: '1', caseNo: '110年度消字第1號', dateIso: '2021-01-01', fullText: TEXT },
  { id: '2', caseNo: '110年度消字第2號', dateIso: '2021-02-01', fullText: '被告提起上訴。原告為消費者。' },
  { id: '3', caseNo: '110年度消字第3號', dateIso: '2021-03-01', fullText: '與消費無關。' },
];

test('執行：程式判斷已排除的案件不呼叫 AI；AI 只對需要的案件呼叫', async () => {
  const calls = [];
  const criteria = [program('inc', 'include', ['消費者']), program('exc', 'exclude', ['上訴']), ai('ai1', 'include')];
  const fake = async (system, user) => {
    calls.push(user);
    return JSON.stringify({ verdict: 'met', quotes: ['原告為消費者'], basis: 'ok' });
  };
  const run = await runCriteria({ query: '消費', criteria, cases: CASES }, { ai: fake });
  // 案件 2 含「上訴」被程式排除、案件 3 不含「消費者」被程式排除，兩者都不呼叫 AI；只有案件 1 需要 AI。
  assert.equal(calls.length, 1);
  assert.equal(run.outcomes.find((o) => o.id === '3').decision, 'exclude');
  assert.equal(run.outcomes.find((o) => o.id === '2').decision, 'exclude');
  assert.equal(run.outcomes.find((o) => o.id === '1').decision, 'include');
  assert.equal(run.summary.total, 3);
  assert.equal(run.summary.exclude, 2);
});

test('執行：沒有提供 AI 但有 AI 標準時拋錯，不靜默略過', async () => {
  await assert.rejects(runCriteria({ query: 'q', criteria: [ai('a', 'include')], cases: CASES }, {}), /AI/);
});

test('執行：可以取消', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runCriteria({ query: 'q', criteria: [program('a', 'include', ['消費者'])], cases: CASES }, { signal: controller.signal }), /取消/);
});

test('規劃：列出 AI 判斷的案件數、呼叫次數與估計費用（價格由呼叫端提供）', () => {
  const criteria = [program('inc', 'include', ['消費者']), program('exc', 'exclude', ['上訴']), ai('ai1', 'include'), ai('ai2', 'exclude')];
  const plan = planRun(criteria, CASES);
  assert.equal(plan.total, 3);
  assert.equal(plan.skippedByProgram, 2);
  assert.equal(plan.aiCases, 1);
  assert.equal(plan.aiCalls, 2);
  const cost = estimateCostUsd(plan, 1);
  assert.ok(cost > 0);
  assert.equal(estimateCostUsd(plan, 0), 0);
});

test('重新檢索的結果分開保存：編號遞增、既有紀錄不被覆蓋；比較可找出決定改變的案件', async () => {
  const criteria = [program('inc', 'include', ['消費者'])];
  const first = await runCriteria({ query: '第一次查詢', criteria, cases: CASES, now: new Date('2026-11-10T00:00:00Z') });
  let runs = appendRun([], first);
  const second = await runCriteria({ query: '第二次查詢', criteria: [program('inc', 'include', ['購買'])], cases: CASES });
  runs = appendRun(runs, second);
  assert.deepEqual(runs.map((r) => r.runNo), [1, 2]);
  assert.equal(runs[0].query, '第一次查詢');
  const diff = compareRuns(runs[0], runs[1]);
  // 第一次以「消費者」納入案件 1、2；第二次以「購買」只有案件 1 符合，因此案件 2 由納入改為排除。
  assert.deepEqual(diff.changed, [{ id: '2', caseNo: '110年度消字第2號', from: 'include', to: 'exclude' }]);
  assert.deepEqual(diff.onlyInA, []);
});

test('匯出表格：每案一列、每條標準一欄，依據無效會標示', async () => {
  const run = await runCriteria({ query: 'q', criteria: [program('inc', 'include', ['消費者'])], cases: CASES });
  const t = toCriteriaTable(run);
  assert.equal(t.headers.length, 5);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[0][3], '納入');
  assert.match(t.headers[4], /^納入：/);
  const summary = summarizeRun(run.outcomes);
  assert.equal(summary.total, 3);
});
