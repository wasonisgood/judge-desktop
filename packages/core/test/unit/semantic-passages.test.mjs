// 事實見解檢索（issue #10）測試：段落切分、AI 排序的引文驗證、回退、案號分組、結果內小助手的越界引用檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitParagraphs, splitPassages, passagesOfKind, rankPassages, verifyRanking, keywordRank, groupByCase,
  buildRankPrompt, buildScopedQaPrompt, checkScopedAnswer, askScopedQuestion, caseNoKey,
} from '../../dist/index.js';

const FACT_OPINION_SECTIONS = {
  主文: '被告無罪。',
  事實及理由: [
    '被告甲於民國一百十年一月一日，在臺北市某便利商店持刀恐嚇店員。',
    '被告未取得告訴人同意即取走現金新臺幣三千元。',
    '理由',
    '本院認為被告之行為構成恐嚇危害安全罪，應依刑法第三百零五條論罪。',
    '按被告犯後態度良好，爰依刑法第五十九條酌減其刑。',
  ].join('\n'),
};

test('段落切分：空行與換行分段，過長段落依句號再切，過短段落併入前段', () => {
  assert.deepEqual(splitParagraphs('第一段內容足夠長。\n\n第二段內容足夠長。'), ['第一段內容足夠長。', '第二段內容足夠長。']);
  const long = '甲'.repeat(300) + '。' + '乙'.repeat(300) + '。';
  const pieces = splitParagraphs(long, 400);
  assert.ok(pieces.length >= 2);
  assert.ok(pieces.every((p) => p.length <= 400 + 1));
  // 過短段落併入「前一段」；開頭的短段落沒有前段，會單獨保留。
  assert.deepEqual(splitParagraphs('足夠長的第一段內容。\n短'), ['足夠長的第一段內容。短']);
  assert.deepEqual(splitParagraphs('短\n足夠長的第二段落內容'), ['短', '足夠長的第二段落內容']);
});

test('段落類型：事實及理由依第一個理由起頭的段落分界；主文不納入', () => {
  const ps = splitPassages('C1', FACT_OPINION_SECTIONS);
  const facts = passagesOfKind(ps, 'fact');
  const ops = passagesOfKind(ps, 'opinion');
  assert.equal(facts.length, 2);
  assert.match(facts[0].text, /持刀恐嚇/);
  assert.equal(ops.length, 2);
  assert.match(ops[0].text, /本院認為/);
  assert.ok(ps.every((p) => !p.text.includes('被告無罪')), '主文不納入段落');
  assert.ok(ps.every((p) => p.id.startsWith('C1#')));
  assert.equal(new Set(ps.map((p) => p.id)).size, ps.length, '段落識別碼唯一');
});

const CAND = [
  {
    caseId: 'C1',
    caseNo: '110年度易字第1號',
    dateIso: '2021-01-01',
    fullText: '被告甲持刀恐嚇店員，取走現金。本院認為構成恐嚇危害安全罪。',
    passages: splitPassages('C1', { 事實及理由: '被告甲持刀恐嚇店員，取走現金。\n理由\n本院認為構成恐嚇危害安全罪。' }),
  },
  {
    caseId: 'C2',
    caseNo: '111年度易字第2號',
    dateIso: '2022-01-01',
    fullText: '被告乙於夜間徘徊，未有恐嚇行為。',
    passages: splitPassages('C2', { 事實及理由: '被告乙於夜間徘徊，未有恐嚇行為。' }),
  },
];

test('AI 排序：引文逐字存在才採用；捏造的引文與不存在的序號丟棄', async () => {
  const raw = JSON.stringify({
    ranked: [
      { n: 1, score: 0.9, quote: '持刀恐嚇店員', basis: '直接相關' },
      { n: 2, score: 0.4, quote: '法院判決書從未出現的句子', basis: '捏造' },
      { n: 99, score: 0.7, quote: '未有恐嚇行為', basis: '序號不存在' },
    ],
  });
  const fake = async () => raw;
  const r = await rankPassages(fake, '持刀恐嚇', 'fact', CAND);
  assert.equal(r.scoreSource, 'ai');
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].caseId, 'C1');
  assert.equal(r.hits[0].score, 0.9);
  assert.equal(r.discarded, 2);
  assert.match(r.hits[0].passageText, /持刀恐嚇/);
});

test('AI 排序：分數夾在 0 至 1；同一段落重複時只保留一次', async () => {
  const raw = JSON.stringify({ ranked: [
    { n: 1, score: 5, quote: '持刀恐嚇店員', basis: 'a' },
    { n: 1, score: 0.2, quote: '持刀恐嚇店員', basis: 'dup' },
  ] });
  const { hits } = verifyRanking(raw, [{ n: 1, candidate: CAND[0], passage: CAND[0].passages[0] }]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].score, 1);
});

test('AI 失敗（服務錯誤）時回退為關鍵字，並明確標示非語意', async () => {
  const r = await rankPassages(async () => { throw new Error('額度不足'); }, '持刀恐嚇', 'fact', CAND);
  assert.equal(r.scoreSource, 'keyword');
  assert.match(r.notice, /額度不足/);
  assert.match(r.notice, /非語意/);
  assert.ok(r.hits.length >= 1);
  assert.match(r.hits[0].basis, /回退結果/);
});

test('尚未設定 AI 服務時回退為關鍵字，並說明', async () => {
  const r = await rankPassages(undefined, '恐嚇', 'fact', CAND);
  assert.equal(r.scoreSource, 'keyword');
  assert.match(r.notice, /尚未設定 AI/);
});

test('AI 回覆格式錯誤會視為失敗並回退（不採信任何結果）', async () => {
  const r = await rankPassages(async () => '我覺得 C1 很相關', '恐嚇', 'fact', CAND);
  assert.equal(r.scoreSource, 'keyword');
});

test('關鍵字回退：只列出有命中的段落，並依覆蓋率排序', () => {
  const hits = keywordRank('恐嚇店員', 'fact', CAND);
  assert.ok(hits.every((h) => h.score > 0));
  assert.equal(hits[0].caseId, 'C1');
});

test('同一案號的多個段落合併；依相似度或案號排序', () => {
  const hits = [
    { caseId: 'A', caseNo: '110年度易字第9號', dateIso: null, passageId: 'A#1', kind: 'fact', passageText: 'x', score: 0.3, quote: 'q', basis: 'b' },
    { caseId: 'A', caseNo: '110年度易字第9號', dateIso: null, passageId: 'A#2', kind: 'fact', passageText: 'y', score: 0.6, quote: 'q', basis: 'b' },
    { caseId: 'B', caseNo: '110年度易字第1號', dateIso: null, passageId: 'B#1', kind: 'fact', passageText: 'z', score: 0.5, quote: 'q', basis: 'b' },
  ];
  const bySim = groupByCase(hits, 'similarity');
  assert.deepEqual(bySim.map((g) => g.caseId), ['A', 'B']);
  assert.equal(bySim[0].hits.length, 2);
  assert.equal(bySim[0].best, 0.6);
  const byNo = groupByCase(hits, 'caseNo');
  assert.deepEqual(byNo.map((g) => g.caseId), ['B', 'A']);
});

test('提示的段落類型與研究問題都會帶入', () => {
  const p = buildRankPrompt('冒充檢察官', 'opinion', [{ n: 1, candidate: CAND[0], passage: CAND[0].passages[0] }]);
  assert.match(p.system, /法官見解/);
  assert.match(p.user, /冒充檢察官/);
});

test('結果內小助手：引用結果集內的案號通過', () => {
  const c = checkScopedAnswer('被告因恐嚇而有罪（110年度易字第1號）。', ['110年度易字第1號', '111年度易字第2號']);
  assert.equal(c.status, 'ok');
  assert.deepEqual(c.cited, ['110年度易字第1號']);
});

test('結果內小助手：引用結果集以外的案號 → 不可採信', () => {
  const c = checkScopedAnswer('另見 109年度易字第7號 也是類似見解。', ['110年度易字第1號']);
  assert.equal(c.status, 'outside_citation');
  assert.deepEqual(c.outside, ['109年度易字第7號']);
});

test('結果內小助手：沒有附案號 → uncited；案號格式的空白差異不影響比對', () => {
  assert.equal(checkScopedAnswer('沒有附案號的回答。', ['110年度易字第1號']).status, 'uncited');
  const c = checkScopedAnswer('（110 年度易字第 1 號）', ['110年度易字第1號']);
  assert.equal(c.status, 'ok');
  assert.equal(caseNoKey('110 年度易字第 1 號'), '110年度易字第1號');
});

test('結果內小助手：提示只包含結果集，超過篇幅的案件列為省略（不讓模型推測）', () => {
  const cases = [{ caseNo: '110年度易字第1號', passages: ['甲'.repeat(50)] }, { caseNo: '110年度易字第2號', passages: ['乙'.repeat(50)] }];
  const p = buildScopedQaPrompt('q', cases, 100);
  assert.equal(p.omitted, 1);
  assert.match(p.user, /另有 1 件/);
  assert.doesNotMatch(p.user, /110年度易字第2號】/);
});

test('結果內小助手：AI 回答越界時 askScopedQuestion 回傳檢查結果；結果集為空時拒絕', async () => {
  const cases = [{ caseNo: '110年度易字第1號', passages: ['被告持刀恐嚇。'] }];
  const r = await askScopedQuestion(async () => '依 110年度易字第1號與 999年度易字第9號，可知…', 'q', cases);
  assert.equal(r.check.status, 'outside_citation');
  await assert.rejects(askScopedQuestion(async () => 'x', 'q', []), /空/);
});
