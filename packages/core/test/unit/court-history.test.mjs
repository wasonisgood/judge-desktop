// 歷審裁判測試：樣本為真實司法院頁面（列印歷審清單與判決內頁）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePrintHistory, locateInHistory, parseDetailHtml } from '../../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(here, '..', 'fixtures', name), 'utf8');

const kshm = parsePrintHistory(fx('judicial_history_kshm_shangsu1285.html'));
const tndm = parsePrintHistory(fx('judicial_history_tndm_fujin622.html'));

test('列印歷審清單：列數、法院、案號、日期正確解析', () => {
  assert.equal(kshm.length, 8, '應有 8 列');
  assert.equal(kshm[0].court, '臺灣澎湖地方法院');
  assert.equal(kshm[0].caseNo, '114 年度 訴 字第 35 號裁定');
  assert.equal(kshm[0].dateDisplay, '115.02.23');
  assert.equal(kshm[0].dateIso, '2026-02-23', '民國 115 年 = 西元 2026 年');
  assert.equal(kshm[3].court, '臺灣高等法院 高雄分院');
});

test('列印歷審清單：沒有日期或黑色圖示的列為繫屬中（pending）', () => {
  assert.equal(kshm[6].pending, true, '第 7 列沒有日期，應為繫屬中');
  assert.equal(kshm[6].dateIso, null);
  assert.equal(kshm[0].pending, false);
  assert.equal(kshm.some((r) => r.supremeAppeal), false, '此樣本沒有紅色圖示');
});

test('列印歷審清單：沒有表格時回傳空陣列（沒有歷審）', () => {
  assert.deepEqual(parsePrintHistory('<html><body>無資料</body></html>'), []);
});

test('定位：字號與日期同時相符時，正確定位並列出前後審級', () => {
  const pos = locateInHistory(tndm, { title: '臺灣臺南地方法院 115 年度 附民 字第 622 號刑事判決', dateIso: '2026-11-06' });
  assert.equal(pos.status, 'located');
  assert.equal(pos.index, 1, '本案是第 2 列（判決），不是第 1 列（裁定）');
  assert.equal(pos.total, 2);
  assert.equal(pos.prior.length, 1);
  assert.match(pos.prior[0].caseNo, /裁定$/);
  assert.match(pos.summary, /歷審第 2 筆（共 2 筆）/);
});

test('定位：同一天有多筆相同案號與法院時，明確回報無法判定，不猜', () => {
  // 高雄分院 上訴 1285 號裁定在 2026-11-06 有兩筆，無法自動判定是哪一筆
  const pos = locateInHistory(kshm, { title: '臺灣高等法院 高雄分院 115 年度 上訴 字第 1285 號裁定', dateIso: '2026-11-06' });
  assert.equal(pos.status, 'ambiguous');
  assert.equal(pos.index, null);
  assert.match(pos.summary, /無法自動判定/);
});

test('定位：日期不符時回報 not_found，並列出全部列', () => {
  const pos = locateInHistory(kshm, { title: '臺灣高等法院 高雄分院 115 年度 上訴 字第 1285 號裁定', dateIso: '2020-01-01' });
  assert.equal(pos.status, 'not_found');
  assert.equal(pos.subsequent.length, kshm.length);
});

test('定位：沒有歷審資料時回報 no_history', () => {
  const pos = locateInHistory([], { title: '任何字號', dateIso: null });
  assert.equal(pos.status, 'no_history');
});

test('內頁：取得「列印歷審清單」連結，且不再使用錯誤的 AJAX 後備寫法', () => {
  const d = parseDetailHtml(fx('judicial_detail_tcba_quan17.html'), 'TCBA,115,全,17,20261106,1', 'https://judgment.judicial.gov.tw/FJUD/data.aspx?x=1');
  assert.ok(d.printHistoryUrl, '應找到列印歷審清單的網址');
  assert.match(d.printHistoryUrl, /printHistory\.aspx\?id=/);
  assert.deepEqual(d.history, [], '未取得清單前，歷審應為空，不得從頁面上任意連結猜測');
  assert.equal(d.historyPosition, null);
});

test('紅色圖示（上訴至最高法院審理中）：列前的「*」標記會被去除，並正確標示', () => {
  const red = parsePrintHistory(fx('judicial_history_red_kshm1009.html'));
  assert.equal(red.length, 4);
  assert.equal(red[2].court, '臺灣高等法院 高雄分院', '「*」應被去除');
  assert.equal(red[2].supremeAppeal, true);
  assert.equal(red.filter((r) => r.supremeAppeal).length, 1);
  const pos = locateInHistory(red, { title: '臺灣高等法院 高雄分院 115 年度上訴字第 1009 號刑事裁定', dateIso: '2026-10-30' });
  assert.equal(pos.status, 'located');
  assert.equal(pos.index, 3, '本案為第 4 筆（裁定，2026-10-30）');
  assert.equal(pos.supremeAppeal, true);
  assert.match(pos.summary, /最高法院審理中/);
});
