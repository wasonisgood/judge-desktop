// 任意格式匯入測試：日期（含民國年）、判決 id、DOCX 表格解析、AI 欄位對照的範圍檢查、清單整理（去重、略過非字號列、字號抽取）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ti = require('../dist/main/services/tableImport.js');

test('日期：西元、斜線、民國年、中文格式；無效回傳 null', () => {
  assert.equal(ti.normalizeDate('2026-01-05'), '2026-01-05');
  assert.equal(ti.normalizeDate('2026/1/5'), '2026-01-05');
  assert.equal(ti.normalizeDate('115/01/05'), '2026-01-05');
  assert.equal(ti.normalizeDate('115年1月5日'), '2026-01-05');
  assert.equal(ti.normalizeDate('2026-13-40'), null);
  assert.equal(ti.normalizeDate('不是日期'), null);
  assert.equal(ti.dateFromText('裁判日期 115年3月2日 宣判'), '2026-03-02');
});

test('判決 id：司法院網址取 id 參數；ID 形式直接採用；其他回傳 null', () => {
  assert.equal(ti.judgmentIdFrom('https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSV_103_2434_20141119'), 'TPSV_103_2434_20141119');
  assert.equal(ti.judgmentIdFrom('TPSV_103_2434_20141119'), 'TPSV_103_2434_20141119');
  assert.equal(ti.judgmentIdFrom('隨便一段文字'), null);
});

test('DOCX：表格每列成為一列，段落各成一列', () => {
  const xml = '<w:body><w:p><w:r><w:t>判決清單</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>字號</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>案由</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>113年度消字第1號</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>買賣</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>';
  const rows = ti.docxRows(xml);
  assert.deepEqual(rows, [['判決清單'], ['字號', '案由'], ['113年度消字第1號', '買賣']]);
});

test('AI 欄位對照：超出範圍或不是整數的欄號一律丟棄', () => {
  const m = ti.sanitizeMapping({ headerRow: 0, caseNo: 1, title: 9, court: -3, href: 'x', dateIso: 2 }, 5, 4);
  assert.deepEqual(m, { headerRow: 0, caseNo: 1, title: null, court: null, dateIso: 2, cause: null, href: null });
  assert.equal(ti.sanitizeMapping({ headerRow: 99 }, 5, 4).headerRow, null);
});

test('清單整理：略過非字號列、去重、字號由整列抽出、有網址時以判決 id 去重', () => {
  const rows = [
    ['序號', '字號', '法院', '日期', '網址'],
    ['1', '臺灣臺北地方法院 115 年度消字第 3 號', '', '115/02/01', 'https://x/data.aspx?ty=JD&id=AAA_1'],
    ['2', '沒有字號的說明列', '', '', ''],
    ['3', '臺灣高等法院 114 年度上字第 9 號', '臺灣高等法院', '2025-03-01', 'https://x/data.aspx?ty=JD&id=AAA_1'],
    ['4', '', '', '', '裁判 113年度易字第7號 刑事判決'],
  ];
  const map = { headerRow: 0, caseNo: 1, title: 1, court: 2, dateIso: 3, cause: null, href: 4 };
  const items = ti.normalizeRows(rows, map);
  assert.equal(items.length, 2, '第 3 列與第 1 列的判決 id 相同，應去重；第 2 列沒有字號');
  assert.equal(items[0].id, 'AAA_1');
  assert.equal(items[0].dateIso, '2026-02-01');
  assert.equal(items[0].court, '臺灣臺北地方法院', '法院欄空白時由字號推出');
  assert.equal(items[1].title, '113年度易字第7號', '沒有字號欄時，從整列抽出字號');
});

test('清單整理：沒有標題列時從第一列開始', () => {
  const items = ti.normalizeRows([['臺灣臺北地方法院 115 年度消字第 3 號']], { headerRow: null, caseNo: 0, title: null, court: null, dateIso: null, cause: null, href: null });
  assert.equal(items.length, 1);
});
