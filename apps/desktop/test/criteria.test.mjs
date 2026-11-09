// 納入／排除核查（issue #12）桌面端純函式測試：畫面輸入整理、候選判決來源、依據明細與無效依據標示。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const logic = require('../dist/main/services/criteriaLogic.js');
const core = require('@judge/core');

const TEXT = '原告為消費者，於民國一百一十年向被告購買商品。被告未就此提起上訴，本案已確定。';

test('parseCriteriaInput：略過空白列、補識別碼、關鍵字拆分並去除空白', () => {
  const out = logic.parseCriteriaInput([
    { kind: 'include', text: '原告為消費者', method: 'ai' },
    { kind: 'include', text: '', method: 'ai' },
    { kind: 'exclude', text: '未經上訴', method: 'program', keywords: '未上訴、 未提起上訴 ,', keywordMode: 'all' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(out[1].keywords, ['未上訴', '未提起上訴']);
  assert.equal(out[1].keywordMode, 'all');
  assert.equal(out[0].keywords, undefined);
});

test('parseCriteriaInput：程式判斷沒有關鍵字、或沒有描述時拒絕', () => {
  assert.throws(() => logic.parseCriteriaInput([{ kind: 'include', text: '消費者', method: 'program', keywords: [] }]), /關鍵字/);
  assert.throws(() => logic.parseCriteriaInput([{ kind: 'include', text: '', method: 'program', keywords: ['消費者'] }]), /描述/);
  assert.throws(() => logic.parseCriteriaInput([]), /至少/);
  assert.throws(() => logic.parseCriteriaInput('not-an-array'), /格式/);
});

test('candidateIdsOf：列表取 items、範圍整理取各工作表判決列，且去除重複', () => {
  assert.deepEqual(logic.candidateIdsOf('list', { items: [{ id: 'A' }, { id: 'B' }, { id: 'A' }] }), ['A', 'B']);
  assert.deepEqual(
    logic.candidateIdsOf('scope', { sheets: [{ rows: [{ id: 'X' }, { id: 'Y' }] }, { rows: [{ id: 'Y' }, { id: 'Z' }] }] }),
    ['X', 'Y', 'Z'],
  );
  assert.deepEqual(logic.candidateIdsOf('brief', { fullText: 'x' }), []);
  assert.deepEqual(logic.candidateIdsOf('list', null), []);
});

test('needsFetch：已有全文的候選不再讀取', () => {
  const details = { A: { fullText: '全文' }, B: { fullText: '  ' } };
  assert.equal(logic.needsFetch('A', details), false);
  assert.equal(logic.needsFetch('B', details), true);
  assert.equal(logic.needsFetch('C', details), true);
});

test('toCaseInput：沒有內頁時以列表摘要補上字號與日期，全文為空', () => {
  const c = logic.toCaseInput('ID1', undefined, { title: '臺灣高等法院 110 年上字第 1 號', dateIso: '2021-03-01' });
  assert.deepEqual(c, { id: 'ID1', caseNo: '臺灣高等法院 110 年上字第 1 號', dateIso: '2021-03-01', fullText: '' });
  const d = logic.toCaseInput('ID2', { meta: { caseNo: '110 年上字第 2 號', dateIso: '2021-04-01' }, fullText: TEXT });
  assert.equal(d.caseNo, '110 年上字第 2 號');
  assert.equal(d.fullText, TEXT);
});

test('依據明細：AI 依據無法逐字找到時標示為無效，且該條改為無法判斷', async () => {
  const criteria = logic.parseCriteriaInput([
    { kind: 'include', text: '原告為消費者', method: 'ai' },
    { kind: 'exclude', text: '未經上訴', method: 'program', keywords: ['撤回上訴'] },
  ]);
  // AI 回傳一句不存在於原文的引文（編造），應被判為無效。
  const fakeAi = async () => JSON.stringify({ verdict: 'met', quotes: ['原告為企業經營者，於去年大量採購。'], basis: '符合' });
  const run = await core.runCriteria({ query: '消費者', criteria, cases: [{ id: 'j1', caseNo: '案1', dateIso: null, fullText: TEXT }] }, { ai: fakeAi });
  const ai = run.outcomes[0].results.find((r) => r.criterionId === 'c1');
  assert.equal(ai.verdict, 'unknown');
  assert.equal(ai.invalidEvidence, true);
  assert.equal(run.summary.invalidEvidenceCount, 1);

  const rows = logic.evidenceRows(run);
  assert.equal(rows.length, 2);
  const aiRow = rows.find((r) => r[2] === 'AI 判斷');
  assert.equal(aiRow[3], '無法判斷');
  assert.match(aiRow[6], /無效/);
  const progRow = rows.find((r) => r[2] === '程式判斷');
  assert.equal(progRow[3], '不符合');
  assert.match(progRow[4], /「撤回上訴」未出現/);
  assert.equal(progRow[6], '有效');
});

test('依據明細：逐字依據保留在判決原文中', async () => {
  const criteria = logic.parseCriteriaInput([{ kind: 'include', text: '原告為消費者', method: 'ai' }]);
  const quote = '原告為消費者，於民國一百一十年向被告購買商品。';
  const ai = async () => JSON.stringify({ verdict: 'met', quotes: [quote], basis: '原告自述為消費者' });
  const run = await core.runCriteria({ query: 'q', criteria, cases: [{ id: 'j1', caseNo: '案1', dateIso: null, fullText: TEXT }] }, { ai });
  const r = run.outcomes[0].results[0];
  assert.equal(r.verdict, 'met');
  assert.deepEqual(r.quotes, [quote]);
  assert.ok(TEXT.includes(r.quotes[0]));
});
