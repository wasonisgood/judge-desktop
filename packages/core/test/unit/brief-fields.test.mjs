// 精讀欄位測試：提示只包含勾選的欄位（含自訂欄位與說明），並依順序輸出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefJudgment, DEFAULT_BRIEF_FIELDS, normalizeBriefFields } from '../../dist/index.js';

const detail = {
  meta: { id: 'x', title: '臺北地方法院 115 年度 測字 第 1 號 判決', court: '臺北地方法院', caseNo: null, judgmentType: '判決', dateMinguo: '115.01.01', dateIso: '2026-01-01', cause: '測試', sourceUrl: 'u' },
  sections: { 主文: '原告之訴駁回。', 理由: '理由內容。' },
  history: [], historyPosition: null, printHistoryUrl: null, relatedLaws: [], fullText: '主文：原告之訴駁回。理由：理由內容。',
};

function fakeAi(captured) {
  return async (system, user) => {
    captured.push(user);
    // 依提示中的段落標題回傳對應的段落（模擬 AI 完整遵守欄位）
    const headings = [...user.matchAll(/^\d+\. (.+?)(：|$)/gm)].map((m) => m[1]);
    return JSON.stringify({ title: '精讀', sections: headings.map((h) => ({ heading: h, paragraphs: ['內容'] })) });
  };
}

test('預設欄位：未指定時使用六個預設段落', async () => {
  const cap = [];
  const doc = await briefJudgment(fakeAi(cap), detail, { focus: '', length: '約 1 頁' });
  assert.equal(doc.sections.length, DEFAULT_BRIEF_FIELDS.length);
  assert.match(cap[0], /一、案件事實/);
});

test('只勾選部分欄位：提示與輸出都只包含勾選的欄位，依勾選順序', async () => {
  const cap = [];
  const doc = await briefJudgment(fakeAi(cap), detail, {
    focus: '', length: '半頁',
    fields: [{ name: '四、法院見解' }, { name: '五、結論' }],
  });
  assert.deepEqual(doc.sections.map((s) => s.heading), ['四、法院見解', '五、結論']);
  assert.doesNotMatch(cap[0], /一、案件事實/, '未勾選的欄位不應出現在提示中');
});

test('自訂欄位：名稱與說明都會交給 AI', async () => {
  const cap = [];
  await briefJudgment(fakeAi(cap), detail, {
    focus: '', length: '約 1 頁',
    fields: [{ name: '原告請求的金額', description: '列出原告請求的各項金額與依據' }, { name: '一、案件事實' }],
  });
  assert.match(cap[0], /原告請求的金額：列出原告請求的各項金額與依據/);
  assert.ok(cap[0].indexOf('原告請求的金額') < cap[0].indexOf('一、案件事實'), '順序應依使用者設定');
});

test('欄位清理：去除空白名稱與重複名稱', () => {
  const r = normalizeBriefFields([{ name: ' 結論 ' }, { name: '' }, { name: '結論' }, { name: '爭點', description: '  ' }]);
  assert.deepEqual(r, [{ name: '結論', description: undefined }, { name: '爭點', description: undefined }]);
});

test('全部取消勾選時明確報錯，不會送出空白的提示', async () => {
  await assert.rejects(briefJudgment(fakeAi([]), detail, { focus: '', length: '約 1 頁', fields: [{ name: '  ' }] }), /至少勾選一個/);
});
