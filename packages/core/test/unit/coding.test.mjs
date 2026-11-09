// 標編碼標注工序測試：分析欄位（預設集與自訂）、依據逐字驗證、待覆核標示、關鍵字模式的範圍列表、逐案編碼。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CODING_FIELDS, normalizeCodingFields, verifyCodedValue, verifyCodedValues, countPendingReview, formatCodedCell,
  buildScopeTable, analyzeCase,
} from '../../dist/index.js';

const TEXT = '原告主張被告行為構成侵權行為，依國家賠償法第二條第二項請求賠償。法院認為該請求應予駁回，理由如下。';
const field = (id, name) => ({ id, name });

test('預設欄位集與舊欄位 id 一致，順序與舊版 Excel 相同（分類、爭點、法院見解、法條適用、結論）', () => {
  assert.deepEqual(DEFAULT_CODING_FIELDS.map((f) => f.id), ['group', 'issue', 'holding', 'statuteApplication', 'outcome']);
  assert.deepEqual(DEFAULT_CODING_FIELDS.map((f) => f.name), ['分類', '爭點', '法院見解', '法條適用', '結論']);
});

test('欄位清理：去除未勾選、空名與重複名，保留順序，自訂欄位指派不重複的識別碼', () => {
  const out = normalizeCodingFields([
    { id: 'issue', name: '爭點' },
    { name: '不要的', enabled: false },
    { name: '  ' },
    { name: '原告請求的金額', description: '  金額  ' },
    { name: '爭點' },
    { id: 'custom-2', name: '第二個自訂' },
    { id: 'custom-2', name: '重複識別碼' },
  ]);
  assert.deepEqual(out.map((f) => f.name), ['爭點', '原告請求的金額', '第二個自訂', '重複識別碼']);
  assert.equal(new Set(out.map((f) => f.id)).size, out.length, '識別碼必須唯一');
  assert.equal(out[1].description, '金額');
  assert.equal(out[0].id, 'issue');
});

test('依據驗證：只保留逐字存在於原文中的引文；無效依據標示為待覆核', () => {
  const v = verifyCodedValue(TEXT, field('holding', '法院見解'), {
    value: '法院認為請求應予駁回',
    evidence: ['法院認為該請求應予駁回', '法院認為被告應賠償一百萬元'],
  });
  assert.deepEqual(v.evidence, ['法院認為該請求應予駁回']);
  assert.equal(v.droppedEvidence, 1);
  assert.equal(v.reviewStatus, 'pending');
  assert.match(v.reviewNote, /移除 1 則/);
  for (const q of v.evidence) assert.ok(TEXT.includes(q));
});

test('依據全部有效時不需覆核；沒有依據或內容為空時需覆核', () => {
  const ok = verifyCodedValue(TEXT, field('issue', '爭點'), { value: '國家賠償請求', evidence: ['依國家賠償法第二條第二項請求賠償'] });
  assert.equal(ok.reviewStatus, 'none');
  assert.equal(ok.reviewNote, undefined);

  const noEvidence = verifyCodedValue(TEXT, field('issue', '爭點'), { value: '國家賠償請求', evidence: ['完全不在原文中的句子'] });
  assert.equal(noEvidence.reviewStatus, 'pending');
  assert.deepEqual(noEvidence.evidence, []);

  const empty = verifyCodedValue(TEXT, field('issue', '爭點'), { value: '', evidence: [] });
  assert.equal(empty.reviewStatus, 'pending');
  assert.equal(empty.reviewNote, '未取得內容');
});

test('批次驗證：每個欄位都有結果；AI 漏掉的欄位視為未取得（待覆核）', () => {
  const fields = [field('issue', '爭點'), field('outcome', '結論')];
  const out = verifyCodedValues(TEXT, fields, { values: [{ id: 'outcome', value: '駁回', evidence: ['該請求應予駁回'] }] });
  assert.equal(out.length, 2);
  assert.equal(out[0].fieldId, 'issue');
  assert.equal(out[0].reviewStatus, 'pending');
  assert.equal(out[1].reviewStatus, 'none');
  assert.equal(countPendingReview([{ values: out }]), 1);
  assert.equal(verifyCodedValues(TEXT, fields, 'not json').length, 2);
});

test('匯出儲存格：內容、依據與待覆核標示在同一格', () => {
  const v = verifyCodedValue(TEXT, field('outcome', '結論'), { value: '駁回', evidence: ['該請求應予駁回'] });
  const text = formatCodedCell(v);
  assert.match(text, /^駁回\n依據：該請求應予駁回$/);
  assert.equal(formatCodedCell(undefined), '');
  assert.match(formatCodedCell(verifyCodedValue(TEXT, field('x', 'x'), { value: '' })), /【待覆核】未取得內容/);
});

// ---- 關鍵字模式與逐案編碼（不連網：以假的搜尋與內頁來源注入） ----
function fakeDetail(id, title, fullText, relatedLaws = []) {
  return {
    meta: { id, title, court: '臺灣高等法院', caseNo: null, judgmentType: null, dateMinguo: '110年1月1日', dateIso: '2021-01-01', cause: '國家賠償', sourceUrl: `https://example.test/${id}` },
    sections: { 主文: '上訴駁回。' },
    history: [],
    historyPosition: null,
    printHistoryUrl: null,
    pdfUrl: null,
    relatedLaws,
    fullText,
  };
}

test('關鍵字模式：列出所有搜尋結果（不做法規引用比對），引用條文取自相關法條', async () => {
  const details = {
    a: fakeDetail('a', '案A', '本案引用國家賠償法第二條。', ['國家賠償法第2條']),
    b: fakeDetail('b', '案B', '本案與賠償無關。', []),
  };
  const search = [
    { id: 'a', title: '案A', dateDisplay: '', dateIso: '2021-01-01', cause: '國賠', href: '' },
    { id: 'b', title: '案B', dateDisplay: '', dateIso: '2022-01-01', cause: '', href: '' },
  ];
  const rows = await buildScopeTable({
    statute: '',
    keywordMode: true,
    searchQuery: '戒嚴 賠償',
    maxItems: 10,
    searchSource: async () => search,
    detailSource: async (id) => details[id],
  });
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(rows[0].citedArticles, ['國家賠償法第2條']);
  assert.deepEqual(rows[1].citedArticles, []);

  // 對照：未開啟關鍵字模式時，沒有引用該法規的判決會被濾掉
  const strict = await buildScopeTable({
    statute: '國家賠償法',
    maxItems: 10,
    searchSource: async () => search,
    detailSource: async (id) => details[id],
  });
  assert.deepEqual(strict.map((r) => r.id), ['a']);
});

test('逐案編碼：一次 AI 呼叫產生勾選欄位，依據經驗證，舊欄位同步填入', async () => {
  const d = fakeDetail('a', '案A', TEXT);
  const row = { id: 'a', title: '案A', court: null, dateIso: null, cause: '', result: '', citedArticles: ['國家賠償法第2條'], lawNotes: [], historyPosition: '', excerpts: { main: '', citing: '' }, href: '' };
  let calls = 0;
  const ai = async (_system, user) => {
    calls++;
    assert.match(user, /id「outcome」/);
    assert.doesNotMatch(user, /id「issue」/, '未勾選的欄位不得交給 AI');
    return JSON.stringify({
      values: [
        { id: 'outcome', value: '駁回', evidence: ['該請求應予駁回', '法院認為被告應賠償'] },
        { id: 'group', value: '程序駁回', evidence: [] },
      ],
    });
  };
  const out = await analyzeCase(ai, '國家賠償法', row, d, { fields: [{ id: 'outcome', name: '結論', enabled: true }, { name: '原告請求的金額', enabled: true }, { id: 'issue', name: '爭點', enabled: false }] });
  assert.equal(calls, 1);
  assert.equal(out.values.length, 2);
  const outcome = out.values.find((v) => v.fieldId === 'outcome');
  assert.deepEqual(outcome.evidence, ['該請求應予駁回']);
  assert.equal(outcome.reviewStatus, 'pending');
  const custom = out.values.find((v) => v.fieldName === '原告請求的金額');
  assert.equal(custom.reviewStatus, 'pending');
  assert.equal(out.outcome, '駁回');
  assert.equal(out.issue, '');
  assert.equal(JSON.parse(JSON.stringify(out)).values.length, 2, '結果可序列化');
});
