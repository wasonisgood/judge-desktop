// 覆核與匯出測試（不需要網路）：Excel 每案一列、每欄一欄、待覆核標示與依據工作表；Word 含依據段落與覆核狀態；
// 覆核狀態寫回檔案項目時保留處理流程紀錄。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('@judge/core');
const { buildScopeWorkbook, buildScopeDocx } = require('../dist/main/scopeExporters.js');
const { mergePayloadItem, addItem } = require('../dist/main/library.js');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');

const TEXT = '原告依國家賠償法第二條第二項請求賠償。法院認為該請求應予駁回，理由如下。';
const FIELDS = [
  { id: 'issue', name: '爭點' },
  { id: 'outcome', name: '結論' },
  { id: 'custom-3', name: '原告請求的金額' },
];

function row(id) {
  return {
    id, title: `案${id}`, court: '臺灣高等法院', dateIso: '2021-01-01', cause: '國家賠償', result: '',
    citedArticles: ['國家賠償法第2條'], lawNotes: [], historyPosition: '', excerpts: { main: '', citing: '' }, href: `https://example.test/${id}`,
  };
}

/** 三案：a 全部有效；b 結論沒有依據（待覆核）；c 結論已被人工接受。 */
function sampleSheet() {
  const f = FIELDS;
  const rows = [row('a'), row('b'), row('c')];
  const analyses = [
    { id: 'a', issue: '國賠', holding: '', statuteApplication: '', outcome: '駁回', group: '', values: [
      core.verifyCodedValue(TEXT, f[0], { value: '國家賠償請求', evidence: ['依國家賠償法第二條第二項請求賠償'] }),
      core.verifyCodedValue(TEXT, f[1], { value: '駁回', evidence: ['該請求應予駁回'] }),
      core.verifyCodedValue(TEXT, f[2], { value: '判決原文未載明', evidence: [] }),
    ] },
    { id: 'b', issue: '', holding: '', statuteApplication: '', outcome: '', group: '', values: [
      core.verifyCodedValue(TEXT, f[0], { value: '國賠', evidence: ['依國家賠償法第二條第二項請求賠償'] }),
      core.verifyCodedValue(TEXT, f[1], { value: '駁回', evidence: [] }),
      core.verifyCodedValue(TEXT, f[2], { value: '', evidence: [] }),
    ] },
    { id: 'c', issue: '', holding: '', statuteApplication: '', outcome: '', group: '', values: [
      core.verifyCodedValue(TEXT, f[0], { value: '國賠', evidence: ['依國家賠償法第二條第二項請求賠償'] }),
      core.reviewValue(core.verifyCodedValue(TEXT, f[1], { value: '駁回', evidence: [] }), 'accept', '2026-11-10T00:00:00Z'),
      core.verifyCodedValue(TEXT, f[2], { value: '一百萬元', evidence: ['該請求應予駁回'] }),
    ] },
  ];
  return { statute: '國家賠償法', rows, analyses, synthesis: { overview: '概述', groups: [], trends: '趨勢', conclusion: '結論' }, fields: f };
}

test('Excel：每案一列、每個分析欄位一欄，並有待覆核欄位與覆核狀態欄', async () => {
  const buf = await buildScopeWorkbook([sampleSheet()], {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('國家賠償法');
  assert.ok(ws);
  assert.equal(ws.rowCount, 4, '表頭加三案');
  const headers = ws.getRow(1).values.slice(1);
  for (const name of ['爭點', '結論', '原告請求的金額', '待覆核欄位', '覆核狀態']) assert.ok(headers.includes(name), `缺少欄位 ${name}`);
  const col = (name) => headers.indexOf(name) + 1;
  assert.equal(ws.getRow(2).getCell(col('爭點')).value, '國家賠償請求');
  assert.equal(ws.getRow(3).getCell(col('待覆核欄位')).value, '結論、原告請求的金額');
  assert.match(ws.getRow(3).getCell(col('覆核狀態')).value, /待覆核 2／已接受 0/);
  assert.equal(ws.getRow(4).getCell(col('結論')).value, '駁回', 'c 案的結論已接受，內容保留');
  assert.ok(!ws.getRow(4).getCell(col('待覆核欄位')).value, 'c 案的各欄都有有效依據或已接受，沒有待覆核欄位');
  // 待覆核的格子有底色，已接受的沒有
  assert.equal(ws.getRow(3).getCell(col('結論')).fill?.fgColor?.argb, 'FFF8D7DA');
  assert.notEqual(ws.getRow(2).getCell(col('結論')).fill?.fgColor?.argb, 'FFF8D7DA');
});

test('Excel：依據工作表逐則列出依據段落，無依據與覆核狀態都在同一列', async () => {
  const buf = await buildScopeWorkbook([sampleSheet()], {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ev = wb.getWorksheet('依據_國家賠償法');
  assert.ok(ev, '應有依據工作表');
  const rows = [];
  ev.eachRow((r, n) => { if (n > 1) rows.push(r.values.slice(1)); });
  const quoteRows = rows.filter((r) => r[4] === '依國家賠償法第二條第二項請求賠償' || r[4] === '該請求應予駁回');
  assert.ok(quoteRows.length >= 2, '已驗證的依據都要出現在依據工作表');
  assert.ok(rows.some((r) => r[0] === 2 && r[2] === '爭點' && r[5] === '無須覆核'), 'b 案爭點有效，無須覆核');
  assert.ok(rows.some((r) => r[0] === 2 && r[2] === '結論' && r[4] === '（無依據）' && r[5] === '待覆核'), 'b 案結論無依據且待覆核');
  assert.ok(rows.some((r) => r[0] === 3 && r[2] === '結論' && r[5] === '已接受'), 'c 案結論已接受');
});

test('Word：依據段落與覆核狀態寫入表格，待覆核格子標示底色', async () => {
  const buf = await buildScopeDocx([sampleSheet()], {});
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.ok(xml.includes('依據：依國家賠償法第二條第二項請求賠償'), '依據段落應在表格中');
  assert.ok(xml.includes('【待覆核】'), '待覆核標示');
  assert.ok(xml.includes('【已接受】'), '已接受標示');
  assert.ok(xml.includes('w:fill="F8D7DA"'), '待覆核格子底色');
  assert.ok(xml.includes('覆核狀態：共 9 格'), 'Word 有覆核摘要');
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 1);
});

test('Word：人工修改過的內容保留 AI 原文', async () => {
  const sh = sampleSheet();
  sh.analyses[0].values[0] = core.reviewValue(sh.analyses[0].values[0], 'edit', '2026-11-10T00:00:00Z', '國賠請求');
  const xml = new AdmZip(await buildScopeDocx([sh], {})).readAsText('word/document.xml');
  assert.ok(xml.includes('AI 原文：國家賠償請求'));
  assert.ok(xml.includes('【已修改】'));
});

test('檔案項目：覆核狀態寫回時只更新 sheets，保留處理流程紀錄；找不到的 id 不新增', () => {
  let items = addItem([], { kind: 'scope', title: 't', summary: 's', payload: { sheets: [], trace: { steps: ['x'] } } });
  const id = items[0].id;
  items = mergePayloadItem(items, id, { sheets: [{ statute: 'new' }] });
  assert.deepEqual(items[0].payload.trace, { steps: ['x'] });
  assert.deepEqual(items[0].payload.sheets, [{ statute: 'new' }]);
  const same = mergePayloadItem(items, 'nope', { sheets: [] });
  assert.equal(same.length, 1);
  assert.deepEqual(same[0].payload.sheets, [{ statute: 'new' }]);
});
