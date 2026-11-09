// Step 5 確定判決判斷：五種結果、上訴期間邊界（第 120／121 天）、同案其他被告的上訴不計入、定應執行刑標示。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeFinality, DEFAULT_APPEAL_DAYS, FINALITY_LABEL, appealedFrom, extractDefendants } from '../../dist/index.js';

const TITLE_1 = '臺灣臺北地方法院 112 年度訴字第 100 號 判決';
const CAUSE_1 = { court: '臺灣臺北地方法院', caseNo: '112 年度 訴 字第 100 號判決', dateDisplay: '115.01.01', dateIso: '2026-01-01' };
const TEXT_1 = '臺灣臺北地方法院刑事判決\n112年度訴字第100號\n被告 甲○○\n主文\n甲○○犯詐欺罪，處有期徒刑 1 年。\n事實及理由\n……';

const row = (r) => ({ court: r.court, caseNo: r.caseNo, dateDisplay: r.dateDisplay ?? '', dateIso: r.dateIso ?? null, pending: r.pending ?? false, supremeAppeal: r.supremeAppeal ?? false });
const hist = (r, fullText = null) => ({ row: row(r), fullText });

// 上訴審判決：開頭「不服……判決」指向第一審；header 內列出上訴人（被告）姓名。
const appealText = (name, court = '臺灣臺北地方法院', caseNo = '112年度訴字第100號') =>
  `臺灣高等法院刑事判決\n115年度上訴字第50號\n上訴人即被告 ${name}\n上列上訴人因詐欺案件，不服${court} ${caseNo}判決，提起上訴。\n主文\n原判決撤銷。\n`;

const T = { title: TITLE_1, dateIso: '2026-01-01', fullText: TEXT_1 };
const HIST_T = hist(CAUSE_1, TEXT_1);

test('五種結果：本件確定（無上訴、已逾上訴期間）', () => {
  const r = judgeFinality({ target: T, defendant: '甲○○', history: [HIST_T], today: '2026-06-01' });
  assert.equal(r.outcome, 'final');
  assert.equal(r.label, FINALITY_LABEL.final);
  assert.equal(r.label, '本件確定');
});

test('五種結果：尚在上訴期間（無歷審、裁判日起 61 天）', () => {
  const sole = { target: { ...T, dateIso: '2026-06-01' }, defendant: '甲○○', history: [], today: '2026-08-01' };
  const r = judgeFinality(sole);
  assert.equal(r.outcome, 'in_appeal_period');
  assert.equal(r.label, '尚在上訴期間');
});

test('五種結果：本件經上訴，已確定（上訴審已逾期間且無後續上訴）', () => {
  const A = { court: '臺灣高等法院', caseNo: '115 年度 上訴 字第 50 號判決', dateDisplay: '115.04.01', dateIso: '2026-04-01' };
  const r = judgeFinality({
    target: T, defendant: '甲○○', today: '2026-12-01',
    history: [HIST_T, hist(A, appealText('甲○○'))],
  });
  assert.equal(r.outcome, 'appealed_final');
  assert.equal(r.label, '本件經上訴，已確定');
  assert.equal(r.finalJudgment.court, '臺灣高等法院');
  assert.equal(r.appealChain.length, 1);
});

test('五種結果：本件經上訴，尚未確定（上訴審仍在上訴期間）', () => {
  const A = { court: '臺灣高等法院', caseNo: '115 年度 上訴 字第 50 號判決', dateDisplay: '115.04.01', dateIso: '2026-04-01' };
  const r = judgeFinality({
    target: T, defendant: '甲○○', today: '2026-05-01',
    history: [HIST_T, hist(A, appealText('甲○○'))],
  });
  assert.equal(r.outcome, 'appealed_pending');
  assert.equal(r.label, '本件經上訴，尚未確定');
});

test('五種結果：本件經上訴，尚未確定（後續審級繫屬中，尚無裁判書）', () => {
  const A = { court: '臺灣高等法院', caseNo: '115 年度 上訴 字第 50 號判決', dateDisplay: '115.04.01', dateIso: '2026-04-01' };
  const pending = { court: '最高法院', caseNo: '115 年度 台上 字第 9 號', pending: true, supremeAppeal: true };
  const r = judgeFinality({
    target: T, defendant: '甲○○', today: '2026-12-01',
    history: [HIST_T, hist(A, appealText('甲○○')), hist(pending)],
  });
  assert.equal(r.outcome, 'appealed_pending');
});

test('五種結果：待確認（無法定位本件、被告姓名不符、缺少裁判日期）', () => {
  const miss = judgeFinality({ target: T, defendant: '甲○○', history: [hist({ court: '臺灣士林地方法院', caseNo: '1 年度 訴 字第 1 號判決', dateIso: '2026-01-01' }, 'x')], today: '2026-06-01' });
  assert.equal(miss.outcome, 'unknown');
  assert.match(miss.basis, /無法在歷審中定位本件/);

  const noName = judgeFinality({ target: T, defendant: '乙○○', history: [HIST_T], today: '2026-06-01' });
  assert.equal(noName.outcome, 'unknown');
  assert.match(noName.basis, /被告姓名/);

  const noDate = judgeFinality({ target: { ...T, dateIso: null }, defendant: '甲○○', history: [], today: '2026-06-01' });
  assert.equal(noDate.outcome, 'unknown');
});

test('待確認：後續列未取得裁判書時不猜（無法判斷是否為本件的上訴）', () => {
  const A = { court: '臺灣高等法院', caseNo: '115 年度 上訴 字第 50 號判決', dateDisplay: '115.04.01', dateIso: '2026-04-01' };
  const r = judgeFinality({ target: T, defendant: '甲○○', today: '2026-12-01', history: [HIST_T, hist(A, null)] });
  assert.equal(r.outcome, 'unknown');
  assert.match(r.basis, /未取得裁判書/);
});

test('上訴期間邊界：第 120 天仍在期間內，第 121 天起視為確定（無上訴）', () => {
  assert.equal(DEFAULT_APPEAL_DAYS, 120);
  // 2026-01-01 起算：2026-05-01 為第 120 天，2026-05-02 為第 121 天。
  const day120 = judgeFinality({ target: T, defendant: '甲○○', history: [HIST_T], today: '2026-05-01' });
  assert.equal(day120.outcome, 'in_appeal_period');
  const day121 = judgeFinality({ target: T, defendant: '甲○○', history: [HIST_T], today: '2026-05-02' });
  assert.equal(day121.outcome, 'final');
});

test('上訴期間邊界：上訴審裁判日起第 120 天尚未確定，第 121 天確定', () => {
  const A = { court: '臺灣高等法院', caseNo: '115 年度 上訴 字第 50 號判決', dateDisplay: '115.01.01', dateIso: '2026-01-01' };
  const history = [HIST_T, hist(A, appealText('甲○○'))];
  const day120 = judgeFinality({ target: T, defendant: '甲○○', history, today: '2026-05-01' });
  assert.equal(day120.outcome, 'appealed_pending');
  const day121 = judgeFinality({ target: T, defendant: '甲○○', history, today: '2026-05-02' });
  assert.equal(day121.outcome, 'appealed_final');
});

test('上訴期間可調整：appealDays 改為 30 天', () => {
  const day30 = judgeFinality({ target: T, defendant: '甲○○', history: [HIST_T], today: '2026-01-31', appealDays: 30 });
  assert.equal(day30.outcome, 'in_appeal_period');
  const day31 = judgeFinality({ target: T, defendant: '甲○○', history: [HIST_T], today: '2026-02-01', appealDays: 30 });
  assert.equal(day31.outcome, 'final');
  assert.throws(() => judgeFinality({ target: T, defendant: '甲○○', history: [HIST_T], today: '2026-02-01', appealDays: 0 }), RangeError);
});

test('同一起訴書其他被告的上訴不計入本被告', () => {
  // 乙的上訴：開頭同樣不服第一審判決，但上訴人是乙，判決中不載明甲。
  const header1 = '臺灣臺北地方法院刑事判決\n被告 甲○○、乙○○\n主文\n……';
  const T2 = { ...T, fullText: header1 };
  const A_yi = { court: '臺灣高等法院', caseNo: '115 年度 上訴 字第 50 號判決', dateDisplay: '115.04.01', dateIso: '2026-04-01' };
  const r = judgeFinality({
    target: T2, defendant: '甲○○', today: '2026-12-01',
    history: [hist(CAUSE_1, header1), hist(A_yi, appealText('乙○○'))],
  });
  assert.equal(r.outcome, 'final');
  assert.equal(r.appealChain.length, 0);
});

test('appealedFrom：取出「不服……判決」子句', () => {
  assert.match(appealedFrom(appealText('甲○○')), /臺灣臺北地方法院 112年度訴字第100號/);
  assert.equal(appealedFrom('沒有上訴字樣的判決'), null);
});

test('定應執行刑：確定判決未定應執行刑時標示另查「聲」字裁定；已定時標示已定', () => {
  const notSet = judgeFinality({ target: T, defendant: '甲○○', history: [HIST_T], today: '2026-06-01' });
  assert.equal(notSet.aggregate.status, 'not_set');
  assert.match(notSet.aggregate.note, /聲/);

  const withAgg = { ...T, fullText: TEXT_1 + '\n甲○○ 犯數罪，應執行有期徒刑 2 年，定應執行刑。' };
  const set = judgeFinality({ target: withAgg, defendant: '甲○○', history: [hist(CAUSE_1, withAgg.fullText)], today: '2026-06-01' });
  assert.equal(set.aggregate.status, 'set');

  const pending = judgeFinality({ target: T, defendant: '甲○○', history: [HIST_T], today: '2026-02-01' });
  assert.equal(pending.aggregate.status, 'not_applicable');
});

test('extractDefendants：從判決開頭取出多位被告姓名，遇「犯」等字即止', () => {
  assert.deepEqual(extractDefendants('被告 甲○○、乙○○\n主文\n甲○○犯詐欺罪'), ['甲○○', '乙○○']);
  assert.deepEqual(extractDefendants('上訴人即被告王小明 因詐欺案件'), ['王小明']);
  assert.deepEqual(extractDefendants('本文沒有當事人欄位'), []);
  // 實測回歸：「被告前案紀錄表各1份在卷」不是姓名；「被 告 周卉蘭指定辯護人」只取姓名。
  assert.deepEqual(extractDefendants('被 告 周卉蘭指定辯護人 本院公設辯護人\n被告前案紀錄表各1份在卷'), ['周卉蘭']);
  // 聲請案件的受刑人（標示為「受 刑 人」）。
  assert.deepEqual(extractDefendants('聲 請 人 臺灣桃園地方檢察署檢察官\n受 刑 人 林文棋上列聲請人'), ['林文棋']);
  // 實測回歸：「被告現繫屬」「被告入監執行後」等狀態語不是姓名。
  assert.deepEqual(extractDefendants('被告林文棋現繫屬\n被告入監執行後'), ['林文棋']);
});
