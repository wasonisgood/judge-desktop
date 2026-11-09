// 量化圖表的 Word 匯出測試：圖表以 PNG 嵌入、來源說明與計數單位在圖下；交叉表輸出原生表格；畫面傳入的表格資料需通過形狀檢查。
// 執行前需先建置 apps/desktop（dist）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const { buildChartDocx, pngSize, sanitizeTable } = require('../dist/main/chartExporters.js');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const docXml = (buf) => new AdmZip(buf).readAsText('word/document.xml');

test('PNG 尺寸讀取（IHDR）；非 PNG 拋錯', () => {
  const big = Buffer.alloc(33);
  PNG.copy(big, 0, 0, 24);
  big.writeUInt32BE(640, 16);
  big.writeUInt32BE(480, 20);
  assert.deepEqual(pngSize(big), { width: 640, height: 480 });
  assert.throws(() => pngSize(Buffer.from('not a png at all, long enough to pass length check ..')), /不是 PNG/);
});

test('圖表 Word：嵌入 PNG，來源說明與計數單位位於圖下', async () => {
  const buf = await buildChartDocx({
    title: '案由分布（裁判書數）',
    note: '資料來源：a.xlsx｜篩選：無｜列數 3｜計數單位：裁判書數（依 ID 去重）',
    unitLabel: '裁判書數（依 ID 去重）',
    png: PNG,
  });
  const zip = new AdmZip(buf);
  assert.ok(zip.getEntries().some((e) => e.entryName.startsWith('word/media/') && e.entryName.endsWith('.png')), '應有嵌入的 PNG');
  const xml = docXml(buf);
  assert.ok(xml.includes('案由分布（裁判書數）'));
  const img = xml.indexOf('<w:drawing');
  const unit = xml.indexOf('計數單位：裁判書數（依 ID 去重）');
  const source = xml.indexOf('資料來源：a.xlsx');
  assert.ok(img > 0, '圖片段落存在');
  assert.ok(unit > img, '計數單位寫在圖下');
  assert.ok(source > unit, '來源說明寫在計數單位之後');
  assert.ok(!xml.includes('<w:tbl>'), '一般圖表不輸出表格');
});

test('交叉表 Word：輸出原生表格（含列百分比與合計），並寫入計數單位與來源', async () => {
  const table = sanitizeTable({
    rowTitle: '標的金額級距', colTitle: '律師代理', rowLabels: ['10 至 50 萬', '未滿 10 萬'], colLabels: ['雙方有律師', '雙方無律師'],
    cells: [[3, 1], [0, 2]], rowTotals: [4, 2], colTotals: [3, 3], total: 6,
  });
  assert.ok(table);
  const buf = await buildChartDocx({
    title: '交叉表（列數）', note: '資料來源：b.xlsx｜列數 6', unitLabel: '列數', png: null, table,
  });
  const xml = docXml(buf);
  assert.ok(xml.includes('<w:tbl>'));
  assert.ok(xml.includes('3（75.0%）'), '列百分比');
  assert.ok(xml.includes('>6<'), '總計');
  assert.ok(xml.indexOf('<w:tbl>') < xml.indexOf('計數單位：列數'), '單位寫在表下');
  assert.ok(xml.includes('資料來源：b.xlsx'));
});

test('沒有圖也沒有表格 → 拒絕匯出', async () => {
  await assert.rejects(buildChartDocx({ title: 'x', note: '', unitLabel: '列數' }), /沒有可匯出/);
});

test('畫面傳入的交叉表：形狀不一致或含非數字 → 丟棄', () => {
  const ok = { rowLabels: ['a'], colLabels: ['x', 'y'], cells: [[1, 2]], rowTotals: [3], colTotals: [1, 2], total: 3 };
  assert.ok(sanitizeTable(ok));
  assert.equal(sanitizeTable({ ...ok, cells: [[1]] }), null);
  assert.equal(sanitizeTable({ ...ok, cells: [[1, 'x']] }), null);
  assert.equal(sanitizeTable({ ...ok, rowTotals: [3, 4] }), null);
  assert.equal(sanitizeTable({ ...ok, total: 'many' }), null);
  assert.equal(sanitizeTable(null), null);
});
