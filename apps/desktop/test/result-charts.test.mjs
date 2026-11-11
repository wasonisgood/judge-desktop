// 結果自動出圖測試：列清理、法院與年份推導、預設圖表組合、實際產生 SVG（且文字已跳脫）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const rc = require('../dist/main/services/resultCharts.js');

const rows = [
  { id: 'A1', title: '臺灣臺北地方法院 115 年度 消 字第 1 號民事判決', court: '臺灣臺北地方法院', dateIso: '2026-01-05', cause: '消費者保護', caseType: '民事' },
  { id: 'A2', title: '臺灣高等法院 114 年度 上 字第 9 號民事判決', court: '臺灣高等法院', dateIso: '2025-03-01', cause: '消費者保護', caseType: '民事' },
  { id: 'A3', title: '臺灣臺北地方法院 113 年度 易 字第 7 號刑事判決 <b>x</b>', court: '臺灣臺北地方法院', dateIso: null, cause: '詐欺', caseType: '刑事' },
];

test('列清理：去除重複與非法列，限制字串長度', () => {
  const out = rc.sanitizeResultRows([rows[0], rows[0], { id: '' }, null, 'x', { ...rows[1], title: 'x'.repeat(500) }]);
  assert.equal(out.length, 2);
  assert.equal(out[1].title.length, 200);
});

test('法院與年份推導', () => {
  assert.equal(rc.courtOf('臺灣臺北地方法院 115 年度 消 字第 1 號'), '臺灣臺北地方法院');
  assert.equal(rc.courtOf('沒有年度的字串'), '');
  assert.equal(rc.yearOf('2026-01-05'), '2026');
  assert.equal(rc.yearOf(null), '未知');
});

test('預設圖表：有字號類型時多一張年份分段圖', () => {
  assert.equal(rc.chartSpecs(false).length, 3);
  const withType = rc.chartSpecs(true);
  assert.equal(withType.length, 4);
  assert.equal(withType[3].type, 'stacked');
  assert.equal(withType[3].series, '字號類型');
});

test('產生圖表 SVG：四張圖都有，文字已跳脫（不可出現原始標籤）', () => {
  const { charts, warnings } = rc.buildResultCharts(rows);
  assert.equal(warnings.length, 0);
  assert.equal(charts.length, 4);
  for (const c of charts) assert.match(c.svg, /<svg/);
  assert.match(charts[1].svg, /臺灣臺北地方法院/, '列表沒有法院欄時，法院圖由字號推出');
  assert.equal(charts.some((c) => c.svg.includes('<b>x</b>')), false, '判決標題中的標籤必須跳脫');
});

test('沒有列時回傳提示而不出圖', () => {
  const { charts, warnings } = rc.buildResultCharts([]);
  assert.equal(charts.length, 0);
  assert.match(warnings[0], /沒有可出圖/);
});
