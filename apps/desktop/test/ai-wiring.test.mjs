// 接線測試（不需要網路與金鑰）：以固定回覆取代 AI，驗證 AI 結果確實流入 Excel 與 Word，且 JSON 錯誤會被明確回報。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('@judge/core');
const { buildScopeWorkbook, buildScopeDocx } = require('../dist/main/scopeExporters.js');
const { buildBriefDocx } = require('../dist/main/exporters.js');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');

const row = { id: 'TEST_1', title: '測試字號', court: '測試法院', dateIso: '2020-01-01', cause: '測試案由', result: '駁回', citedArticles: ['某法第1條'], href: 'https://example.test' };
const detail = { meta: { id: 'TEST_1', title: '測試字號', court: '測試法院', caseNo: null, judgmentType: '判決', dateMinguo: '109.1.1', dateIso: '2020-01-01', cause: '測試案由', sourceUrl: 'https://example.test' }, sections: { 主文: '一、上訴駁回。' }, history: [], relatedLaws: [], fullText: '一、上訴駁回。' };

test('逐案與綜合分析的 JSON 會被解析（含 ``` 圍欄）', async () => {
  const ai = async () => '```json\n{"issue":"AI爭點","holding":"AI見解","statuteApplication":"AI適用","outcome":"AI結論","group":"AI類型"}\n```';
  const a = await core.analyzeCase(ai, '某法', row, detail);
  assert.equal(a.issue, 'AI爭點');
  assert.equal(a.group, 'AI類型');
});

test('AI 回覆不是 JSON 時會重試，仍失敗則明確回報', async () => {
  let calls = 0;
  const ai = async () => { calls++; return '這不是 JSON'; };
  await assert.rejects(core.analyzeCase(ai, '某法', row, detail), /AI 回覆不是有效的 JSON/);
  assert.equal(calls, 2);
});

test('服務端錯誤（如金鑰失效）不重試，原樣回報', async () => {
  let calls = 0;
  const ai = async () => { calls++; throw new Error('AI 服務回傳 401：bad key'); };
  await assert.rejects(core.analyzeCase(ai, '某法', row, detail), /401/);
  assert.equal(calls, 1);
});

test('AI 結果會出現在範圍整理表的 Excel 與 Word', async () => {
  const analyses = [{ id: 'TEST_1', issue: 'AI爭點XYZ', holding: 'AI見解', statuteApplication: 'AI適用', outcome: 'AI結論', group: 'AI類型' }];
  const synthesis = { overview: '概述XYZ', groups: [{ name: '類型A', description: '描述', caseIds: ['TEST_1'] }], trends: '趨勢', conclusion: '研究結論XYZ' };
  const sheets = [{ statute: '某法', rows: [row], analyses, synthesis }];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildScopeWorkbook(sheets, {}));
  assert.equal(wb.getWorksheet('某法').getRow(2).getCell(7).value, 'AI爭點XYZ');
  const xml = new AdmZip(await buildScopeDocx(sheets, {})).readAsText('word/document.xml');
  assert.ok(xml.includes('研究結論XYZ') && xml.includes('AI爭點XYZ'));
});

test('AI 精讀結果會出現在單一判決的 Word', async () => {
  const doc = { title: '精讀標題', sections: [{ heading: '一、案件事實', paragraphs: ['事實段XYZ'] }, { heading: '二、爭點', paragraphs: ['爭點段'] }] };
  const xml = new AdmZip(await buildBriefDocx(detail, doc)).readAsText('word/document.xml');
  assert.ok(xml.includes('事實段XYZ') && xml.includes('原判決主文'));
});
