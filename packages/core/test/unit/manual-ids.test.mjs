// 手動輸入判決：網址與 ID 的解析、去除重複、無法辨識的行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManualJudgmentIds } from '../../dist/index.js';

test('解析判決頁網址中的 id 參數，並解碼', () => {
  const r = parseManualJudgmentIds('https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSV_103_2434_20141119&ot=in');
  assert.deepEqual(r.ids, ['TPSV_103_2434_20141119']);
  assert.deepEqual(r.invalid, []);
});

test('直接輸入判決 ID；多行、空行、重複會合併', () => {
  const r = parseManualJudgmentIds('TPSV_103_2434_20141119\n\nTPSV_103_2434_20141119\nTPHV_100_1_20110101\n');
  assert.deepEqual(r.ids, ['TPSV_103_2434_20141119', 'TPHV_100_1_20110101']);
});

test('無法辨識的行放入 invalid（例如中文案由描述）', () => {
  const r = parseManualJudgmentIds('國家賠償 戒嚴\nTPSV_103_2434_20141119');
  assert.deepEqual(r.ids, ['TPSV_103_2434_20141119']);
  assert.deepEqual(r.invalid, ['國家賠償 戒嚴']);
});

test('網址的 id 參數不合法（含特殊字元）時歸為無效', () => {
  const r = parseManualJudgmentIds('https://x.test/data.aspx?id=../../etc');
  assert.deepEqual(r.ids, []);
  assert.equal(r.invalid.length, 1);
});
