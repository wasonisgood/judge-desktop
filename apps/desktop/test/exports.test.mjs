// 匯出測試：用真實司法院資料產生範圍整理表（Excel、Word）、列表 Excel、單一判決 Word，並讀回驗證。
// 執行前需先建置：packages/core 與 apps/desktop（npm run build）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('@judge/core');
const { buildScopeWorkbook, buildScopeDocx } = require('../dist/main/scopeExporters.js');
const { buildListWorkbook, buildBriefDocx } = require('../dist/main/exporters.js');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');

test('範圍整理表 Excel：每部法規一個工作表，表頭正確', { timeout: 600000 }, async () => {
  const rows = await core.buildScopeTable({ statute: '二二八事件處理及補償條例', maxItems: 3 });
  assert.ok(rows.length > 0, '應找到引用該法規的判決');
  const buf = await buildScopeWorkbook([{ statute: '二二八事件處理及補償條例', rows, analyses: [], synthesis: null }], {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('二二八事件處理及補償條例');
  assert.ok(ws, '工作表名稱應為法規名稱');
  assert.equal(ws.getRow(1).getCell(2).value, '裁判字號');
  assert.equal(ws.rowCount, rows.length + 1);
});

test('範圍整理表 Word：每部法規一張表，列數正確', { timeout: 600000 }, async () => {
  const rows = await core.buildScopeTable({ statute: '二二八事件處理及補償條例', maxItems: 2 });
  assert.ok(rows.length > 0, '應找到判決');
  const analyses = rows.map((r) => ({ id: r.id, issue: '爭點', holding: '見解', statuteApplication: '適用', outcome: '結論', group: '類型' }));
  const synthesis = { overview: '概述', groups: [], trends: '趨勢', conclusion: '結論' };
  const buf = await buildScopeDocx([{ statute: '二二八事件處理及補償條例', rows, analyses, synthesis }], {});
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 1);
  assert.equal((xml.match(/<w:tr[ >]/g) || []).length, rows.length + 1);
});

test('列表 Excel 與單一判決 Word', { timeout: 600000 }, async () => {
  const items = await core.searchJudgments('戒嚴', { maxItems: 2 });
  const lx = await buildListWorkbook({ keyword: '戒嚴', items, details: {} });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(lx);
  assert.equal(wb.getWorksheet('判決列表').rowCount, items.length + 1);
  const d = await core.getJudgmentDetail(items[0].id);
  const docx = await buildBriefDocx(d, { title: d.meta.title, sections: [{ heading: '一、案件事實', paragraphs: ['測試段落'] }] });
  const xml = new AdmZip(docx).readAsText('word/document.xml');
  assert.ok(xml.includes('原判決主文'));
});
