// 量化圖表（issue #8）桌面端純函式測試：Excel 讀取與欄位推斷、覆寫、計數單位切換、金額級距、小提琴統計、地圖律師代理率。
// 執行前需先建置：packages/core 與 apps/desktop（npm run build）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
const require = createRequire(import.meta.url);
const core = require('@judge/core');
const chart = require('../dist/main/services/chartData.js');
const ExcelJS = require('exceljs');

const GEO = require('../modules/chart/tw-counties.json');
const { buildChartResult, normalizeCell, uniqueHeaders, effectiveKinds, suggestColumns, isRepresented, countUnits,
  sanitizeChartConfig, withSourceNote, crosstabSvg, orderCrosstabRows, inspectChartWorkbook, loadChartSheet } = chart;

function makeConfig(over = {}) {
  return {
    type: 'bar', unit: 'judgments', title: '', idColumn: 'ID', category: null, series: null, value: null,
    amount: null, percent: false, filters: {}, kindOverrides: {}, ...over,
  };
}

function makeSheet(headers, rows) {
  return { name: 'S', headers, rows };
}

function run(headers, rows, config) {
  const sheet = makeSheet(headers, rows);
  return buildChartResult({
    sheet, fileName: 'test.xlsx', config: makeConfig(config), inferredKinds: core.columnKinds(rows, headers), geo: GEO,
  });
}

test('儲存格正規化：日期、公式結果、富文字、超連結與錯誤值', () => {
  assert.equal(normalizeCell(new Date(2024, 2, 5)), '2024-03-05');
  assert.equal(normalizeCell({ result: 12 }), 12);
  assert.equal(normalizeCell({ richText: [{ text: '甲' }, { text: '乙' }] }), '甲乙');
  assert.equal(normalizeCell({ text: '連結', hyperlink: 'https://x' }), '連結');
  assert.equal(normalizeCell({ error: '#N/A' }), null);
  assert.equal(normalizeCell(Number.NaN), null);
  assert.equal(normalizeCell(undefined), null);
});

test('表頭去重：空白表頭改名、重複名稱加序號', () => {
  assert.deepEqual(uniqueHeaders(['ID', '', 'ID', null]), ['ID', '欄2', 'ID (2)', '欄4']);
});

test('欄位型態覆寫：覆寫優先，且只套用到存在的欄位', () => {
  assert.deepEqual(effectiveKinds({ a: 'number', b: 'category' }, { b: 'number', z: 'date' }), { a: 'number', b: 'number' });
});

test('欄位型態推斷（core）：數值、日期、類別、空白', () => {
  const kinds = core.columnKinds([
    { n: '1,200', d: '2024-01-02', c: '竊盜', e: '' },
    { n: 'NT$50', d: '113/1/2', c: '詐欺', e: null },
  ], ['n', 'd', 'c', 'e']);
  assert.deepEqual(kinds, { n: 'number', d: 'date', c: 'category', e: 'empty' });
});

test('預設欄位猜測：依欄位名稱與型態', () => {
  const headers = ['裁判字號', '法院', '案由', '律師代理', '終結情形', '刑期(月)', '標的金額'];
  const kinds = { '裁判字號': 'category', 法院: 'category', 案由: 'category', 律師代理: 'category', 終結情形: 'category', '刑期(月)': 'number', 標的金額: 'number' };
  const s = suggestColumns(headers, kinds);
  assert.equal(s.id, '裁判字號');
  assert.equal(s.court, '法院');
  assert.equal(s.cause, '案由');
  assert.equal(s.lawyer, '律師代理');
  assert.equal(s.outcome, '終結情形');
  assert.equal(s.amount, '標的金額');
  assert.equal(s.term, '刑期(月)');
});

test('律師代理判斷：含「有」且不含「無」才算有代理；空白視為無', () => {
  assert.equal(isRepresented('雙方有律師'), true);
  assert.equal(isRepresented('僅原告有律師'), true);
  assert.equal(isRepresented('雙方無律師'), false);
  assert.equal(isRepresented('是'), true);
  assert.equal(isRepresented('否'), false);
  assert.equal(isRepresented(''), false);
  assert.equal(isRepresented(null), false);
});

test('計數單位：裁判書數依 ID 去重，列數為原始列數；空 ID 不計入裁判書數', () => {
  const rows = [{ ID: '1' }, { ID: '1' }, { ID: '2' }, { ID: '' }];
  assert.equal(countUnits(rows, 'judgments', 'ID'), 2);
  assert.equal(countUnits(rows, 'rows', 'ID'), 4);
  assert.throws(() => countUnits(rows, 'judgments', null), /ID 欄/);
});

test('案由長條圖：兩種計數單位得到不同數字，標題與來源說明標示單位', () => {
  const headers = ['ID', '案由'];
  const rows = [
    { ID: 'A', 案由: '損害賠償' }, { ID: 'A', 案由: '損害賠償' }, { ID: 'A', 案由: '損害賠償' },
    { ID: 'B', 案由: '損害賠償' }, { ID: 'C', 案由: '租賃' },
  ];
  const j = run(headers, rows, { type: 'bar', unit: 'judgments', category: '案由' });
  assert.match(j.title, /案由分布（裁判書數）$/);
  assert.ok(j.svg.includes('>2</text>'), '裁判書數：損害賠償應為 2 件');
  assert.ok(j.svg.includes('單位：裁判書數（依 ID 去重）'));
  assert.equal(j.judgmentCount, 3);
  assert.match(j.note, /裁判書數 3/);

  const r = run(headers, rows, { type: 'bar', unit: 'rows', category: '案由' });
  assert.match(r.title, /（列數）$/);
  assert.ok(r.svg.includes('>4</text>'), '列數：損害賠償應為 4 列');
  assert.ok(r.svg.includes('單位：列數'));
});

test('小提琴圖：中位數、n 與離群值由固定樣本驗證', () => {
  const headers = ['ID', '罪名', '刑期'];
  const rows = [
    { ID: '1', 罪名: '竊盜罪', 刑期: '1' }, { ID: '2', 罪名: '竊盜罪', 刑期: '2' }, { ID: '3', 罪名: '竊盜罪', 刑期: '3' },
    { ID: '4', 罪名: '竊盜罪', 刑期: '4' }, { ID: '5', 罪名: '竊盜罪', 刑期: '100' },
    { ID: '6', 罪名: '詐欺罪', 刑期: '5' }, { ID: '7', 罪名: '詐欺罪', 刑期: '6' }, { ID: '8', 罪名: '詐欺罪', 刑期: '無期徒刑' },
  ];
  // 刑期欄含非數字文字，推斷為類別；未覆寫時拒絕繪製。
  assert.throws(() => run(headers, rows, { type: 'violin', category: '罪名', value: '刑期' }), /數值欄「刑期」/);
  const res = run(headers, rows, { type: 'violin', category: '罪名', value: '刑期', kindOverrides: { 刑期: 'number' } });
  assert.ok(res.svg.includes('竊盜罪（n=5，中位數 3）'), res.svg.match(/竊盜罪[^<]*/)?.[0]);
  assert.ok(res.svg.includes('詐欺罪（n=2'));
  assert.equal((res.svg.match(/r="2.5"/g) ?? []).length, 1, '只有 100 為離群值');
  assert.ok(res.warnings.some((w) => w.includes('1 筆無法解析')));
});

test('小提琴圖（裁判書數）：同一裁判書同一罪名只計一次', () => {
  const headers = ['ID', '罪名', '刑期'];
  const rows = [
    { ID: 'X', 罪名: '竊盜罪', 刑期: '2' }, { ID: 'X', 罪名: '竊盜罪', 刑期: '3' }, { ID: 'Y', 罪名: '竊盜罪', 刑期: '4' },
  ];
  const kindOverrides = { 刑期: 'number' };
  const j = run(headers, rows, { type: 'violin', category: '罪名', value: '刑期', kindOverrides });
  assert.ok(j.svg.includes('竊盜罪（n=2'));
  const r = run(headers, rows, { type: 'violin', unit: 'rows', category: '罪名', value: '刑期', kindOverrides });
  assert.ok(r.svg.includes('竊盜罪（n=3'));
});

test('交叉表：金額級距邊界正確（10 萬、100 萬、1000 萬），級距依順序排列，空白在最後', () => {
  const headers = ['ID', '金額', '律師'];
  const rows = [
    { ID: '1', 金額: 99999, 律師: '雙方有律師' },
    { ID: '2', 金額: 100000, 律師: '雙方無律師' },
    { ID: '3', 金額: 1000000, 律師: '雙方有律師' },
    { ID: '4', 金額: 10000000, 律師: '雙方無律師' },
    { ID: '5', 金額: '', 律師: '雙方無律師' },
    { ID: '6', 金額: 'x', 律師: '雙方有律師' },
  ];
  const res = run(headers, rows, { type: 'crosstab', unit: 'rows', amount: '金額', series: '律師', kindOverrides: { 金額: 'number' } });
  const pos = (s) => res.html.indexOf(`<th>${s}</th>`);
  assert.ok(pos('未滿 10 萬') > 0);
  assert.ok(pos('未滿 10 萬') < pos('10 至 50 萬'));
  assert.ok(pos('10 至 50 萬') < pos('100 至 500 萬'));
  assert.ok(pos('100 至 500 萬') < pos('1000 萬以上'));
  assert.ok(pos('1000 萬以上') < pos('（空白）'));
  assert.match(res.html, /<th>100 至 500 萬<\/th><td>1（100\.0%）<\/td>/);
  assert.ok(res.warnings.some((w) => w.includes('2 筆')));
  assert.match(res.title, /交叉表（列數）$/);
  assert.ok(res.svg.startsWith('<svg'));
});

test('地圖：整縣市法院著色、分區管轄不著色；律師代理率在圖例與來源', () => {
  const headers = ['ID', '法院', '律師'];
  const rows = [
    { ID: '1', 法院: '臺北地方法院', 律師: '雙方有律師' },
    { ID: '2', 法院: '臺北地方法院', 律師: '雙方無律師' },
    { ID: '3', 法院: '臺中地方法院', 律師: '雙方無律師' },
    { ID: '4', 法院: '智慧財產法院', 律師: '雙方有律師' },
  ];
  const res = run(headers, rows, { type: 'map', category: '法院', value: '律師' });
  // 圖例：臺北地院 50%（2 件）、臺中地院 0%（1 件）
  assert.ok(res.svg.includes('臺灣臺北地方法院：50.0%（2 件）'));
  assert.ok(res.svg.includes('臺灣臺中地方法院：0.0%（1 件）'));
  // 臺中市整縣市由臺中地院涵蓋，依 0% 著色（最淺色）
  assert.match(res.svg, /data-county="臺中市" data-status="court"[\s\S]*?fill="rgb\(222,235,247\)"/);
  // 臺北市為臺北、士林分區：不著色
  assert.match(res.svg, /data-county="臺北市" data-status="split"/);
  assert.ok(res.warnings.some((w) => w.includes('分區管轄（未著色）') && w.includes('臺北市')));
  assert.ok(res.warnings.some((w) => w.includes('不在對照表內')), '智慧財產法院不在對照表');
  assert.ok(res.svg.includes('© OpenStreetMap contributors'));
  assert.ok(res.svg.includes('縣市界線'));
});

test('地圖：沒有界線資料時拋出中文錯誤，不畫出空白地圖', () => {
  const headers = ['ID', '法院', '律師'];
  const sheet = makeSheet(headers, [{ ID: '1', 法院: '臺中地方法院', 律師: '雙方有律師' }]);
  assert.throws(() => buildChartResult({
    sheet, fileName: 'x.xlsx', config: makeConfig({ type: 'map', category: '法院', value: '律師' }),
    inferredKinds: core.columnKinds(sheet.rows, headers), geo: null,
  }), /界線資料缺失/);
});

test('堆疊條圖：百分比模式於單位說明標示；分段超過上限時合併為「其他」', () => {
  const headers = ['ID', '律師', '終結'];
  const rows = [
    { ID: '1', 律師: '雙方有律師', 終結: '原告勝訴' },
    { ID: '2', 律師: '雙方有律師', 終結: '原告敗訴' },
    { ID: '3', 律師: '雙方無律師', 終結: '和解' },
  ];
  const res = run(headers, rows, { type: 'stacked', category: '律師', series: '終結', percent: true });
  assert.ok(res.svg.includes('（每列 100%）'));
  const many = [];
  for (let i = 0; i < 8; i++) many.push({ ID: String(i), 律師: '甲', 終結: `類${i}` });
  const m = run(['ID', '律師', '終結'], many, { type: 'stacked', category: '律師', series: '終結' });
  assert.ok(m.svg.includes('>其他<'));
});

test('篩選：只計入符合條件的列，來源說明列出篩選條件', () => {
  const headers = ['ID', '案由', '法院'];
  const rows = [{ ID: '1', 案由: '損害賠償', 法院: '臺北地方法院' }, { ID: '2', 案由: '租賃', 法院: '臺中地方法院' }];
  const res = run(headers, rows, { type: 'bar', category: '案由', filters: { 法院: ['臺北地方法院'] } });
  assert.equal(res.rowCount, 1);
  assert.match(res.note, /篩選：法院＝臺北地方法院/);
});

test('缺少必要欄位時給出中文錯誤', () => {
  assert.throws(() => run(['ID'], [{ ID: '1' }], { type: 'bar', category: null }), /請選擇類別欄/);
  assert.throws(() => run(['ID'], [{ ID: '1' }], { type: 'bar', unit: 'judgments', idColumn: null, category: 'ID' }), /ID 欄/);
});

test('畫面設定消毒：未知型態與單位改為預設，無效的覆寫與篩選被丟棄', () => {
  const c = sanitizeChartConfig({
    type: 'bogus', unit: 'x', title: 'T', idColumn: 'ID', filters: { 法院: [], 案由: ['損害賠償', 3], '': ['a'] },
    kindOverrides: { 刑期: 'number', 金額: 'bad' }, percent: 'yes',
  });
  assert.equal(c.type, 'bar');
  assert.equal(c.unit, 'judgments');
  assert.deepEqual(c.filters, { 案由: ['損害賠償'] });
  assert.deepEqual(c.kindOverrides, { 刑期: 'number' });
  assert.equal(c.percent, false);
  assert.equal(sanitizeChartConfig(null).type, 'bar');
});

test('來源說明加在 SVG 底部，畫布高度隨之增加', () => {
  const base = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="200" viewBox="0 0 720 200"><rect/></svg>';
  const out = withSourceNote(base, '資料來源：a.xlsx｜列數 3');
  assert.ok(out.includes('height="246" viewBox="0 0 720 246"'));
  assert.ok(out.includes('資料來源：a.xlsx'));
  assert.ok(out.includes('列數 3'));
});

test('交叉表 SVG 與列排序', () => {
  const ct = core.crosstab([{ a: 'x', b: 'p' }, { a: 'y', b: 'p' }, { a: 'y', b: 'q' }], 'a', 'b', { unit: 'rows' });
  const svg = crosstabSvg(ct, { title: 'T', rowTitle: 'a', colTitle: 'b', unitLabel: '列數' });
  assert.ok(svg.startsWith('<svg') && svg.includes('合計'));
  const ordered = orderCrosstabRows(ct, ['x', 'y']);
  assert.deepEqual(ordered.rowLabels, ['x', 'y']);
  assert.deepEqual(orderCrosstabRows(ct, ['y']).rowLabels, ['y', 'x']);
});

test('讀取 xlsx：工作表、表頭、列數與欄位型態；不存在的工作表回報錯誤', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chart-test-'));
  try {
    const file = path.join(dir, 'sample.xlsx');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('判決');
    ws.addRow(['ID', '金額', '日期', '法院']);
    ws.addRow(['A1', 120000, new Date(2024, 0, 2), '臺北地方法院']);
    ws.addRow(['A2', 50000, new Date(2024, 1, 3), '臺中地方法院']);
    ws.addRow(['A2', null, null, null]);
    await wb.xlsx.writeFile(file);

    const info = await inspectChartWorkbook(file);
    assert.equal(info.fileName, 'sample.xlsx');
    assert.equal(info.sheets.length, 1);
    const s = info.sheets[0];
    assert.equal(s.name, '判決');
    assert.deepEqual(s.headers, ['ID', '金額', '日期', '法院']);
    assert.equal(s.rowCount, 3, '全空白列不計入；最後一列只有 ID，仍計入');
    assert.equal(s.kinds['金額'], 'number');
    assert.equal(s.kinds['日期'], 'date');
    assert.equal(s.suggested.amount, '金額');

    const loaded = await loadChartSheet(file, '判決');
    assert.equal(loaded.sheet.rows[0]['日期'], '2024-01-02');
    const res = buildChartResult({ sheet: loaded.sheet, fileName: loaded.fileName, inferredKinds: loaded.inferredKinds, config: makeConfig({ category: '法院' }), geo: GEO });
    assert.equal(res.judgmentCount, 2);

    await assert.rejects(() => loadChartSheet(file, '不存在'), /找不到工作表/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
