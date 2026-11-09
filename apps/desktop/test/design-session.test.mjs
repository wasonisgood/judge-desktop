// 研究設計引導的桌面端純函式測試：追問、手動欄位、AI 欄位檢核、畫面資料、範圍參數帶入。
// 執行前需先建置 apps/desktop（npm run build）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ds = require('../dist/main/designSession.js');

const NOW = new Date('2026-11-10T00:00:00Z');

test('開始研究設計：第一個追問是研究問題，並附理由', () => {
  const s = ds.startSession('  消費者訴訟好像都對消費者不利  ', NOW);
  assert.equal(s.slots.problem, '消費者訴訟好像都對消費者不利', '問題意識應去除前後空白');
  assert.equal(s.turns[0].role, 'user');
  const last = s.turns[s.turns.length - 1];
  assert.equal(last.role, 'guide');
  assert.ok(last.text.length > 0);
  assert.ok(last.rationale && last.rationale.length > 0, '每一步追問都要附理由');
});

test('空白的問題意識不能開始', () => {
  assert.throws(() => ds.startSession('   ', NOW), /問題意識/);
});

test('逐步回答：依追問順序填入欄位，並接著提出下一個追問', () => {
  let s = ds.startSession('消費者訴訟', NOW);
  s = ds.answerCurrent(s, '消費者訴訟中，原告有律師代理是否較容易勝訴？', NOW);
  assert.equal(s.slots.question, '消費者訴訟中，原告有律師代理是否較容易勝訴？');
  s = ds.answerCurrent(s, '原告為消費者的民事訴訟', NOW);
  assert.equal(s.slots.subject, '原告為消費者的民事訴訟');
  const guides = s.turns.filter((t) => t.role === 'guide');
  assert.ok(guides.every((g) => g.rationale), '所有助理回合都附理由');
});

test('期間以西元年解析；沒有年份時拒絕', () => {
  let s = ds.startSession('x', NOW);
  s = ds.answerCurrent(s, '研究問題文字很長很完整', NOW);
  s = ds.answerCurrent(s, '對象', NOW);
  s = ds.answerCurrent(s, '變項', NOW);
  assert.throws(() => ds.answerCurrent(s, '不知道', NOW), /西元年/);
  s = ds.answerCurrent(s, '2018 至 2023', NOW);
  assert.equal(s.slots.yearFrom, 2018);
  assert.equal(s.slots.yearTo, 2023);
});

test('所有追問都回答完後不再提問', () => {
  let s = ds.startSession('x', NOW);
  const answers = ['研究問題文字很長很完整', '對象', '變項', '2018 至 2023', '消費者保護法', '民事', '地方法院'];
  for (const a of answers) s = ds.answerCurrent(s, a, NOW);
  assert.throws(() => ds.answerCurrent(s, '再一次', NOW), /已回答/);
  const view = ds.buildView({ session: s, skipped: [] }, s.id, NOW);
  assert.equal(view.step, null);
});

test('手動欄位：空字串清除、年份驗證、沒有變動時不新增回合', () => {
  let s = ds.startSession('x', NOW);
  s = ds.applyFieldEdits(s, { question: '研究問題文字很長很完整', yearFrom: '2019', yearTo: '2021' }, NOW);
  assert.equal(s.slots.yearFrom, 2019);
  assert.equal(s.slots.yearTo, 2021);
  const before = s.turns.length;
  const same = ds.applyFieldEdits(s, { question: '研究問題文字很長很完整' }, NOW);
  assert.equal(same, s, '沒有實際變動時應回傳原物件');
  assert.equal(same.turns.length, before);
  const cleared = ds.applyFieldEdits(s, { yearFrom: '', yearTo: '' }, NOW);
  assert.equal(cleared.slots.yearFrom, undefined);
  assert.throws(() => ds.applyFieldEdits(s, { yearFrom: '十九年' }, NOW), /西元年/);
  assert.throws(() => ds.applyFieldEdits(s, { yearTo: '1800' }, NOW), /西元年/);
});

test('手動欄位不能覆寫原始問題意識', () => {
  const s = ds.startSession('原始問題', NOW);
  const next = ds.applyFieldEdits(s, { problem: '被改掉' }, NOW);
  assert.equal(next.slots.problem, '原始問題');
});

test('AI 欄位檢核：只保留已知鍵、字串需非空、年份需為合理的整數', () => {
  const out = ds.sanitizeFieldPatch({
    question: '  研究問題  ',
    subject: '',
    variable: 42,
    yearFrom: '2018',
    yearTo: 2023,
    statute: '消費者保護法',
    caseType: '民事',
    courtLevel: '地方法院',
    problem: '不可寫入',
    secret: 'x',
    unknownKey: 'y',
  });
  assert.deepEqual(out, {
    question: '研究問題',
    yearFrom: 2018,
    yearTo: 2023,
    statute: '消費者保護法',
    caseType: '民事',
    courtLevel: '地方法院',
  });
  assert.deepEqual(ds.sanitizeFieldPatch({ yearFrom: 99999 }), {});
  assert.deepEqual(ds.sanitizeFieldPatch(null), {});
  assert.deepEqual(ds.sanitizeFieldPatch(['x']), {});
});

test('AI 整理：使用助理提示詞送出，回傳的是草稿（不寫入 session）', async () => {
  let seen = null;
  const ai = async (system, user, maxTokens) => {
    seen = { system, user, maxTokens };
    return '```json\n{"statute":"消費者保護法","yearFrom":2018,"yearTo":2023,"problem":"x"}\n```';
  };
  const patch = await ds.aiFillFields(ai, '我想看消費者保護法 2018 到 2023 年的判決');
  assert.match(seen.system, /只能是/);
  assert.equal(seen.user, '我想看消費者保護法 2018 到 2023 年的判決');
  assert.deepEqual(patch, { statute: '消費者保護法', yearFrom: 2018, yearTo: 2023 });
});

test('AI 回覆不是 JSON 時報錯', async () => {
  await assert.rejects(ds.aiFillFields(async () => '沒有 JSON', '想研究消費者訴訟'), /JSON/);
  await assert.rejects(ds.aiFillFields(async () => '{}', '   '), /輸入/);
});

test('畫面資料：建議不會自動改動條件，接受後才寫入，略過與已接受的不再出現', () => {
  let s = ds.startSession('x', NOW);
  s = ds.applyFieldEdits(s, {
    question: '研究問題文字很長很完整', subject: '對象', variable: '變項',
    yearFrom: '2010', yearTo: '2023', statute: '消費者保護法',
  }, NOW);
  const before = JSON.stringify(s.slots);
  const view = ds.buildView({ session: s, skipped: [] }, s.id, NOW);
  assert.equal(JSON.stringify(s.slots), before, '組出畫面不得改動條件');
  const period = view.suggestions.find((x) => x.id === 'period-recent');
  const court = view.suggestions.find((x) => x.id === 'court-level');
  assert.ok(period && court, '應提供期間與審級的縮小建議');
  assert.ok(period.rationale && period.tradeoff, '建議需附理由與代價');

  const accepted = ds.acceptById(s, 'period-recent', NOW);
  assert.equal(accepted.slots.yearFrom, 2017, '接受後才套用');
  assert.equal(accepted.accepted.length, 1);

  const skippedView = ds.buildView({ session: s, skipped: ['court-level'] }, s.id, NOW);
  assert.ok(!skippedView.suggestions.some((x) => x.id === 'court-level'), '略過的建議不再出現');
  const acceptedView = ds.buildView({ session: accepted, skipped: [] }, s.id, NOW);
  assert.ok(!acceptedView.suggestions.some((x) => x.id === 'period-recent'), '已接受的建議不再出現');
});

test('接受不存在或已不適用的建議時報錯', () => {
  const s = ds.startSession('x', NOW);
  assert.throws(() => ds.acceptById(s, 'no-such-id', NOW), /不適用/);
});

test('畫面資料：欄位表單使用字串值；範圍參數只在有法規時產生', () => {
  let s = ds.startSession('x', NOW);
  let view = ds.buildView({ session: s, skipped: [] }, s.id, NOW);
  assert.equal(view.scopeOptions, null, '沒有法規時不帶入範圍整理');
  assert.equal(view.fields.yearFrom, '');
  s = ds.applyFieldEdits(s, { question: '研究問題文字很長很完整', statute: '消費者保護法', yearFrom: '2018', yearTo: '2023' }, NOW);
  view = ds.buildView({ session: s, skipped: [] }, s.id, NOW);
  assert.equal(view.fields.yearFrom, '2018');
  assert.deepEqual(view.scopeOptions, {
    statute: '消費者保護法', yearFrom: 2018, yearTo: 2023, searchQuery: '研究問題文字很長很完整',
  });
  assert.ok(view.summaryText.startsWith('研究設計摘要'));
});

test('清單項目：標題取研究問題，沒有時退回問題意識', () => {
  const s = ds.startSession('模糊的問題意識', NOW);
  assert.equal(ds.listItemOf({ session: s, skipped: [] }).title, '模糊的問題意識');
  const withQ = ds.applyFieldEdits(s, { question: '可實證的研究問題' }, NOW);
  assert.equal(ds.listItemOf({ session: withQ, skipped: [] }).title, '可實證的研究問題');
});
