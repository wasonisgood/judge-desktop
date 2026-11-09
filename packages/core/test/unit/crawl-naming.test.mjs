// 文本擷取的純函式：檔名（同名加 _2、_3）、Step 4 檔名、擷取紀錄 CSV（UTF-8 含 BOM）、清單匯入去重與逐列錯誤、Step 1 頁數計算、歷審表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uniqueName, stepTwoFileName, stepFourFileName, buildCsv, parseCsv, buildCrawlLogCsv, CRAWL_LOG_HEADER,
  parseListImport, planListPages, parseTotalCount, listPageUrl, matchHistoryRowToItems, buildHistoryTable,
  LIST_MAX_PAGES, LIST_MAX_ITEMS, safeFileName, isoDay,
} from '../../dist/index.js';

test('uniqueName：不存在則原名；同名加 _2、_3，不覆蓋', () => {
  const taken = new Set();
  const exists = (n) => taken.has(n);
  assert.equal(uniqueName('清單.xlsx', exists), '清單.xlsx');
  taken.add('清單.xlsx');
  assert.equal(uniqueName('清單.xlsx', exists), '清單_2.xlsx');
  taken.add('清單_2.xlsx');
  assert.equal(uniqueName('清單.xlsx', exists), '清單_3.xlsx');
  taken.add('清單_文本');
  assert.equal(uniqueName('清單_文本', exists), '清單_文本_2');
});

test('Step 2／Step 4 檔名：清單序號.txt、清單序號-歷審序號.txt（如 7-2.txt）', () => {
  assert.equal(stepTwoFileName(3), '3.txt');
  assert.equal(stepFourFileName(7, 2), '7-2.txt');
});

test('safeFileName：去除不能用於檔名的字元並限制長度', () => {
  assert.equal(safeFileName('a/b:c*d?'), 'a_b_c_d_');
  assert.equal(safeFileName('   '), '未命名');
  assert.equal(safeFileName('x'.repeat(200)).length, 120);
});

test('CSV：UTF-8 含 BOM，引號與逗號正確跳脫，可還原', () => {
  const text = buildCsv([['a', 'b'], ['x,y', 'say "hi"'], ['換行\n內容', 3]]);
  assert.equal(text.charCodeAt(0), 0xfeff);
  const back = parseCsv(text);
  assert.deepEqual(back, [['a', 'b'], ['x,y', 'say "hi"'], ['換行\n內容', '3']]);
});

test('擷取紀錄 CSV：失敗列寫明原因，成功列無原因', () => {
  const text = buildCrawlLogCsv([
    { index: 1, step: 'Step 2', title: '臺灣高等法院 115 年度上訴字第 1 號 判決', url: 'https://x?id=1', ok: true, file: '1.txt' },
    { index: 2, step: 'Step 2', title: '某案', url: 'https://x?id=2', ok: false, reason: 'HTTP 503' },
  ]);
  const rows = parseCsv(text);
  assert.deepEqual(rows[0], CRAWL_LOG_HEADER);
  assert.equal(rows[1][4], '成功');
  assert.equal(rows[1][5], '1.txt');
  assert.equal(rows[2][4], '失敗');
  assert.equal(rows[2][6], 'HTTP 503');
});

test('清單匯入：依字號去重（忽略空白）、逐列回報錯誤、序號保留', () => {
  const table = [
    ['Index', 'Title', 'URL'],
    ['1', '臺灣高等法院 115 年度上訴字第 1 號 判決', 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=AAA'],
    ['2', '臺灣高等法院115年度上訴字第1號判決', 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=BBB'],
    ['3', '', 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=CCC'],
    ['4', '某案 字第 4 號', ''],
    ['5', '某案 字第 5 號', 'https://example.com/nothing'],
    ['x', '某案 字第 6 號', 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=DDD'],
    ['7', '某案 字第 7 號', 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=EEE'],
  ];
  const r = parseListImport(table);
  assert.deepEqual(r.items.map((i) => [i.index, i.id]), [[1, 'AAA'], [7, 'EEE']]);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].row, 3);
  // 試算表列號：表頭為第 1 列，資料依序為第 2 列起。
  const msgs = r.errors.map((e) => `${e.row}:${e.message}`);
  assert.deepEqual(msgs, ['4:缺少字號', '5:缺少網址', '6:網址格式不符（需為司法院裁判書網址，含 id 參數）', '7:序號格式錯誤：「x」']);
});

test('清單匯入：沒有序號欄時依列順序補號；缺表頭時整體報錯', () => {
  const r = parseListImport([
    ['Title', 'URL'],
    ['某案 A 字第 1 號', 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=A1'],
    ['某案 A 字第 2 號', 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=A2'],
  ]);
  assert.deepEqual(r.items.map((i) => i.index), [1, 2]);
  assert.equal(r.errors.length, 0);

  const bad = parseListImport([['名稱', '連結'], ['x', 'y']]);
  assert.equal(bad.items.length, 0);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /找不到表頭/);
});

test('Step 1 頁數：每頁 20 筆、上限 25 頁、500 筆', () => {
  assert.deepEqual(planListPages(0).pageNumbers, []);
  const one = planListPages(1);
  assert.equal(one.pages, 1);
  assert.equal(one.maxItems, 1);
  assert.equal(planListPages(20).pages, 1);
  assert.equal(planListPages(21).pages, 2);
  const exact = planListPages(500);
  assert.equal(exact.pages, 25);
  assert.equal(exact.maxItems, 500);
  assert.equal(exact.truncated, false);
  const over = planListPages(1234);
  assert.equal(over.pages, LIST_MAX_PAGES);
  assert.equal(over.maxItems, LIST_MAX_ITEMS);
  assert.equal(over.truncated, true);
  assert.equal(over.totalFound, 1234);
});

test('Step 1：讀取「共 N 筆」與翻頁網址（&page=N，取代既有 page）', () => {
  assert.equal(parseTotalCount('<div>共 1,234 筆</div>'), 1234);
  assert.equal(parseTotalCount('共 7 筆'), 7);
  assert.equal(parseTotalCount('沒有數字'), null);
  const base = 'https://judgment.judicial.gov.tw/FJUD/qryresultlst.aspx?ty=JUDBOOK&q=abc';
  assert.equal(listPageUrl(base, 2), `${base}&page=2`);
  assert.equal(listPageUrl(`${base}&page=5`, 3), `${base}&page=3`);
});

test('isoDay：本地日期格式 YYYY-MM-DD', () => {
  assert.equal(isoDay(new Date(2026, 0, 5)), '2026-01-05');
});

test('Step 4 比對：歷審列以字號、法院、日期對應搜尋結果；唯一才算對上', () => {
  const row = { court: '臺灣高等法院 高雄分院', caseNo: '115 年度 上訴 字第 1285 號裁定', dateDisplay: '115.09.03', dateIso: '2026-09-03', pending: false, supremeAppeal: false };
  const item = (id, title, dateIso) => ({ id, title, dateDisplay: '', dateIso, cause: '', href: '' });
  const one = matchHistoryRowToItems(row, [item('X', '臺灣高等法院高雄分院 115 年度上訴字第 1285 號 裁定', '2026-09-03'), item('Y', '臺灣高等法院 115 年度上訴字第 9 號 裁定', '2026-09-03')]);
  assert.equal(one.status, 'matched');
  assert.equal(one.item.id, 'X');
  const dup = matchHistoryRowToItems(row, [item('X', '臺灣高等法院高雄分院 115 年度上訴字第 1285 號 裁定', '2026-09-03'), item('Z', '臺灣高等法院高雄分院 115 年度上訴字第 1285 號 裁定', '2026-09-03')]);
  assert.equal(dup.status, 'ambiguous');
  assert.equal(matchHistoryRowToItems({ ...row, pending: true }, []).status, 'none');
});

test('歷審表：單一審級標為「歷審_1」並註記「自身（無歷審）」；多審級逐列並標示本案', () => {
  const single = buildHistoryTable([{ index: 4, title: '某案', historyRows: [], selfIndex: null }]);
  assert.deepEqual(single[1], [4, '歷審_1', '', '某案', '', '', '自身（無歷審）']);

  const multi = buildHistoryTable([{
    index: 7, title: '某案', selfIndex: 1, urls: ['u1', 'u2'],
    historyRows: [
      { court: 'A院', caseNo: '1 年度 訴 字第 1 號判決', dateDisplay: '115.01.01', dateIso: '2026-01-01', pending: false, supremeAppeal: false },
      { court: 'B院', caseNo: '1 年度 上訴 字第 1 號判決', dateDisplay: '115.04.01', dateIso: '2026-04-01', pending: false, supremeAppeal: false },
    ],
  }]);
  assert.equal(multi.length, 3);
  assert.deepEqual(multi[1].slice(0, 2), [7, '歷審_1']);
  assert.equal(multi[1][5], 'u1');
  assert.equal(multi[2][6], '本案');
});
