// 案件類型參數（範圍整理篩選、精讀提示與字號檢查）的純函式測試，以及介面元件 id 的接線檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveCaseTypeArg, caseTypeSkipNote, briefCaseTypeCheck } = require('../dist/main/services/caseTypeArgs.js');

const root = new URL('../node_modules/@judge/ui/src/js/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

test('解析介面傳入的案件類型：空值為不限；唯一類型用語才套用；無法辨識時說明且不套用', () => {
  assert.deepEqual(resolveCaseTypeArg(''), { caseType: undefined, note: null });
  assert.deepEqual(resolveCaseTypeArg(undefined), { caseType: undefined, note: null });
  assert.deepEqual(resolveCaseTypeArg('民事'), { caseType: '民事', note: null });
  assert.equal(resolveCaseTypeArg('民事案件').caseType, '民事', '研究設計帶入的文字可能含「案件」');
  const bad = resolveCaseTypeArg('民事或刑事');
  assert.equal(bad.caseType, undefined);
  assert.match(bad.note, /無法對應/);
});

test('範圍整理的排除說明：區分字號明載不符與無法判定，數字正確', () => {
  assert.equal(caseTypeSkipNote('消費者保護法', '民事', []), null);
  const note = caseTypeSkipNote('消費者保護法', '民事', [
    { title: '臺灣高等法院 115 年度 易 字第 1 號刑事判決', status: 'by-suffix' },
    { title: '臺中高等行政法院 高等庭 115 年度 訴 字第 102 號判決', status: 'by-court' },
    { title: '臺灣臺北地方法院 113 年度訴字第 2 號', status: 'ambiguous' },
    { title: '臺灣臺北地方法院 113 年度特字第 4 號', status: 'unknown' },
  ]);
  assert.match(note, /排除 4 筆/);
  assert.match(note, /2 筆字號判定為其他類型/);
  assert.match(note, /2 筆字別重疊或不在字別表中/);
  assert.match(note, /臺灣高等法院 115 年度 易 字第 1 號刑事判決（刑事）/, '排除的字號要列出並標示類型');
  assert.match(note, /臺灣臺北地方法院 113 年度訴字第 2 號（重疊）/);
  assert.match(note, /臺灣臺北地方法院 113 年度特字第 4 號（未知）/);
  assert.match(note, /不猜/);
});

test('匯出：Excel 逐案表有「字號類型」欄，說明工作表標示案件類型與排除筆數', async () => {
  const { createRequire: cr } = await import('node:module');
  const r = cr(import.meta.url);
  const ExcelJS = r('exceljs');
  const { buildScopeWorkbook } = r('../dist/main/scopeExporters.js');
  const row = { id: 'A', title: '臺灣臺北地方法院 115 年度 護 字第 111 號民事裁定', court: '臺灣臺北地方法院', dateIso: '2026-01-01', cause: '', result: '', citedArticles: ['某法第1條'], href: 'https://example.test/A', caseTypeLabel: '民事' };
  const buf = await buildScopeWorkbook([{ statute: '某法', rows: [row], analyses: [], synthesis: null, caseType: { type: '民事', excluded: 3 } }], {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('某法');
  // 欄位依表頭名稱定位（欄位順序由 scopeFields 動態決定，不寫死欄號）。
  const headers = ws.getRow(1).values;
  const col = (name) => headers.indexOf(name);
  const typeCol = col('字號類型');
  assert.ok(typeCol > 0, '表頭要有「字號類型」');
  assert.equal(typeCol, headers.length - 1, '字號類型是最後一欄');
  assert.equal(ws.getRow(2).getCell(typeCol).value, '民事');
  const linkVal = ws.getRow(2).getCell(col('判決連結')).value;
  assert.equal(linkVal?.text ?? linkVal, row.href, '判決連結仍在原欄位');
  const info = wb.getWorksheet('說明');
  const texts = [];
  info.eachRow((rw) => texts.push(rw.values.slice(1).join(' ')));
  assert.ok(texts.some((t) => t.includes('案件類型：民事') && t.includes('排除 3 筆')), '說明工作表要寫出案件類型與排除筆數');
});

test('精讀：指定類型作為重點提示，並依字號檢查相符／不符／無法判定（只提醒不阻擋）', () => {
  const none = briefCaseTypeCheck('臺北地院 113 年度訴字第 1 號民事判決', undefined);
  assert.equal(none.status, 'none');
  assert.equal(none.focusHint, '');
  assert.equal(none.note, null);

  const match = briefCaseTypeCheck('臺北地院 113 年度訴字第 1 號民事判決', '民事');
  assert.equal(match.status, 'match');
  assert.match(match.focusHint, /案件類型：民事/);
  assert.match(match.note, /相符/);

  const mismatch = briefCaseTypeCheck('臺北地院 113 年度易字第 1 號刑事判決', '民事');
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.judged, '刑事');
  assert.match(mismatch.note, /不符/);
  assert.match(mismatch.focusHint, /案件類型：民事/, '不符時仍交給 AI 作為提示，由使用者判斷');

  const unknown = briefCaseTypeCheck('臺北地院 113 年度訴字第 1 號', '民事');
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.judged, null);
  assert.match(unknown.note, /無法判定/);
});

test('接線：範圍整理頁與精讀頁的案件類型欄位 id 與控制器讀取的 id 一致', () => {
  assert.match(read('templates/scopePage.js'), /id="scopeCaseType"/);
  assert.match(read('controllers/scope.js'), /\$\('scopeCaseType'\)\.value/);
  assert.match(read('templates/briefPage.js'), /id="briefCaseType"/);
  assert.match(read('controllers/brief.js'), /\$\('briefCaseType'\)\.value/);
  // 既有欄位不改名、不移除
  for (const id of ['scopeFrom', 'scopeTo', 'scopeMax', 'scopeLines', 'scopeRun']) {
    assert.match(read('templates/scopePage.js'), new RegExp(`id="${id}"`));
  }
});
