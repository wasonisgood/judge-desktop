// 量化圖表（issue #8）的測試：統計、計數單位、金額級距邊界、交叉表、格狀地圖、SVG 跳脫。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quantileSorted, median, boxStats, violinShape, silvermanBandwidth,
  toNumber, inferColumnKind, groupCount, crosstab, filterRows, amountBracket, withAmountBracket, sourceNote,
  barChartSvg, stackedBarSvg, violinSvg, crosstabHtml, escapeXml, courtTileOf, tileMapSvg,
} from '../../dist/index.js';

test('分位數採線性內插（與 R type 7 相同）', () => {
  assert.equal(quantileSorted([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantileSorted([1, 2, 3, 4], 0.25), 1.75);
  assert.equal(median([5, 1, 3]), 3);
  assert.throws(() => quantileSorted([], 0.5));
});

test('箱形圖：Tukey 1.5 IQR 離群值與鬚端點', () => {
  const s = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  assert.equal(s.median, 5.5);
  assert.equal(s.q1, 3.25);
  assert.equal(s.q3, 7.75);
  assert.deepEqual(s.outliers, [100]);
  assert.equal(s.whiskerHigh, 9);
  assert.equal(s.whiskerLow, 1);
  assert.equal(s.n, 10);
});

test('核密度：正規化為最大值 1，尾端趨近 0，頻寬對常數資料退回 1', () => {
  const shape = violinShape([10, 10, 11, 12, 30]);
  assert.equal(Math.max(...shape.density), 1);
  assert.ok(shape.density[0] < 0.05 && shape.density.at(-1) < 0.05);
  assert.ok(Math.abs(silvermanBandwidth([7, 7, 7]) - 0.9 * 3 ** -0.2) < 1e-12);
  assert.ok(shape.bandwidth > 0);
});

test('數值解析：去千分位與 NT$，非數字回傳 null', () => {
  assert.equal(toNumber('1,250,000'), 1250000);
  assert.equal(toNumber('NT$ 300'), 300);
  assert.equal(toNumber('10萬'), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(Number.NaN), null);
});

test('欄位型態判斷：數值、日期、類別、全空', () => {
  assert.equal(inferColumnKind(['1', '2,000', null]), 'number');
  assert.equal(inferColumnKind(['2026-01-02', '111/03/04']), 'date');
  assert.equal(inferColumnKind(['詐欺', '竊盜']), 'category');
  assert.equal(inferColumnKind([null, '  ']), 'empty');
});

const ROWS = [
  { id: 'A', cause: '詐欺', lawyer: '有' },
  { id: 'A', cause: '詐欺', lawyer: '有' }, // 同一裁判書的第二列（例如第二位被告）
  { id: 'B', cause: '竊盜', lawyer: '無' },
  { id: 'C', cause: '', lawyer: '有' },
];

test('計數單位：裁判書數依 ID 去重，列數依原始列；空白歸入（空白）', () => {
  const byRows = groupCount(ROWS, 'cause', { unit: 'rows' });
  const byJudgments = groupCount(ROWS, 'cause', { unit: 'judgments', idColumn: 'id' });
  assert.deepEqual(byRows.find((g) => g.key === '詐欺'), { key: '詐欺', count: 2 });
  assert.deepEqual(byJudgments.find((g) => g.key === '詐欺'), { key: '詐欺', count: 1 });
  assert.ok(byRows.some((g) => g.key === '（空白）'));
  assert.throws(() => groupCount(ROWS, 'cause', { unit: 'judgments' }), /ID/);
});

test('交叉表：格子與合計依單位去重，總數與列合計一致', () => {
  const ct = crosstab(ROWS, 'cause', 'lawyer', { unit: 'judgments', idColumn: 'id' });
  const i = ct.rowLabels.indexOf('詐欺');
  const j = ct.colLabels.indexOf('有');
  assert.equal(ct.cells[i][j], 1, '同一裁判書的兩列在同一格只算一件');
  assert.equal(ct.rowTotals[i], 1);
  assert.equal(ct.total, 3);
});

test('金額級距邊界：下界含、上界不含（10 萬屬於 10 至 50 萬）', () => {
  assert.equal(amountBracket('99999'), '未滿 10 萬');
  assert.equal(amountBracket(100000), '10 至 50 萬');
  assert.equal(amountBracket('500,000'), '50 至 100 萬');
  assert.equal(amountBracket(999999), '50 至 100 萬');
  assert.equal(amountBracket(1000000), '100 至 500 萬');
  assert.equal(amountBracket(5000000), '500 萬至 1000 萬');
  assert.equal(amountBracket(10000000), '1000 萬以上');
  assert.equal(amountBracket('未知'), null);
  assert.equal(amountBracket(-5), null);
  const out = withAmountBracket([{ amt: '200000' }, { amt: 'x' }], 'amt');
  assert.deepEqual(out.map((r) => r['標的金額級距']), ['10 至 50 萬', '（空白）']);
});

test('篩選：空條件不篩；指定值依列內容比對', () => {
  assert.equal(filterRows(ROWS, {}).length, 4);
  assert.deepEqual(filterRows(ROWS, { lawyer: ['無'] }).map((r) => r.id), ['B']);
});

test('來源說明標示檔名、篩選、列數與裁判書數', () => {
  const s = sourceNote({ fileName: 'a.xlsx', filters: { 案由: ['詐欺'] }, rowCount: 4, judgmentCount: 3, unit: 'judgments' });
  assert.match(s, /資料來源：a\.xlsx/);
  assert.match(s, /案由＝詐欺/);
  assert.match(s, /裁判書數 3/);
  assert.match(s, /裁判書數（依 ID 去重）/);
});

test('SVG：文字經跳脫，不會注入標籤；長條與堆疊條有輸出', () => {
  assert.equal(escapeXml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  const bar = barChartSvg({ title: '案由 <script>', items: [{ label: '詐欺', value: 3 }, { label: '竊盜', value: 1 }], unitLabel: '裁判書數' });
  assert.match(bar, /^<svg/);
  assert.doesNotMatch(bar, /<script>/);
  assert.match(bar, /&lt;script&gt;/);
  const stack = stackedBarSvg({ title: 't', categories: ['民事'], series: [{ name: '有', values: [3] }, { name: '無', values: [1] }], percent: true, unitLabel: '件' });
  assert.match(stack, /75%/);
});

test('小提琴圖：組別樣本數與中位數標示；沒有數值時顯示提示而非拋錯', () => {
  const svg = violinSvg({ title: '刑期', groups: [{ label: '詐欺', values: [6, 8, 10, 12, 30] }, { label: '空', values: [] }], yLabel: '月', unitLabel: '月' });
  assert.match(svg, /詐欺（n=5，中位數 10）/);
  assert.doesNotMatch(svg, />空（n=/);
  const empty = violinSvg({ title: '刑期', groups: [{ label: 'x', values: [] }], yLabel: '月', unitLabel: '月' });
  assert.match(empty, /沒有可繪製的數值資料/);
});

test('交叉表 HTML：含合計列與可選的列百分比', () => {
  const ct = crosstab(ROWS, 'cause', 'lawyer', { unit: 'rows' });
  const html = crosstabHtml(ct, { rowTitle: '案由', colTitle: '律師', percentByRow: true });
  assert.match(html, /<table class="crosstab">/);
  assert.match(html, /合計/);
  assert.match(html, /%/);
});

test('格狀地圖：法院名稱對應格子；高等與智慧財產法院不畫；有資料的格子依值上色', () => {
  assert.equal(courtTileOf('臺灣士林地方法院').label, '士林');
  assert.equal(courtTileOf('臺灣臺北地方法院').label, '臺北');
  assert.equal(courtTileOf('臺灣高等法院'), null);
  assert.equal(courtTileOf('智慧財產法院'), null);
  const svg = tileMapSvg({ title: '律師代理率', values: [{ court: '臺灣臺北地方法院', value: 80, n: 10 }, { court: '臺灣澎湖地方法院', value: null, n: 0 }], valueLabel: '律師代理率' });
  assert.match(svg, /臺北：80\.0%（10 件）/);
  assert.match(svg, /示意格狀地圖/);
});

test('交叉表與箱形圖以外的統計不會因空陣列崩潰', () => {
  assert.deepEqual(groupCount([], 'x', { unit: 'rows' }), []);
  const ct = crosstab([], 'a', 'b', { unit: 'rows' });
  assert.equal(ct.total, 0);
});
