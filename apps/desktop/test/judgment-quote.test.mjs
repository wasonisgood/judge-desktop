// 跳至原文（主程序部分）：依據定位的結果、找不到的說明、全文取得失敗的顯示文字；畫面接線的靜態檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { locateJudgmentQuote, judgmentFetchError, QUOTE_NOT_FOUND_TEXT, QUOTE_FOUND_TEXT } = require('../dist/main/services/judgmentQuote.js');

const D = {
  meta: { id: 'J1', title: '112年度上字第1號', court: '臺灣高等法院', dateIso: '2023-01-01', dateMinguo: '112.1.1', cause: '國賠', sourceUrl: '' },
  sections: { 主文: '上訴駁回。', 理由: '原告依國家賠償法第二條第二項請求賠償，本院認為該請求應予駁回。' },
  history: [], historyPosition: null, relatedLaws: [], fullText: '',
};

test('依據找到：回傳全文與依據位置，訊息說明已定位', () => {
  const v = locateJudgmentQuote(D, '本院認為該請求應予駁回');
  assert.equal(v.ok, true);
  assert.equal(v.title, '112年度上字第1號');
  assert.ok(v.span, '應有位置');
  assert.equal(v.text.slice(v.span.start, v.span.end), '本院認為該請求應予駁回');
  assert.equal(v.message, QUOTE_FOUND_TEXT);
});

test('依據找不到：span 為 null，訊息明確說明依據可能已失效（不假裝定位）', () => {
  const v = locateJudgmentQuote(D, '法院認為被告應賠償一百萬元整');
  assert.equal(v.ok, true);
  assert.equal(v.span, null);
  assert.equal(v.message, QUOTE_NOT_FOUND_TEXT);
  assert.match(v.message, /原文中找不到此段，依據可能已失效/);
});

test('取得的內容沒有判決原文：視為取得失敗（不是依據找不到）', () => {
  const v = locateJudgmentQuote({ ...D, sections: { 內文: '' }, fullText: '' }, '本院認為該請求應予駁回');
  assert.equal(v.ok, false);
  assert.match(v.error, /^無法取得判決全文：/);
});

test('全文取得失敗：顯示「無法取得判決全文」與原因，不丟錯', () => {
  const msg = judgmentFetchError(new Error('網路逾時'));
  assert.match(msg, /^無法取得判決全文：/);
  assert.ok(msg.length > '無法取得判決全文：'.length, '應附上原因');
});

test('畫面接線：跳至原文走應用程式內視窗，失敗與找不到的文字都由視窗顯示', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const controller = read('js/controllers/scope.js');
  assert.match(controller, /api\.scope\.judgmentText\(/);
  assert.doesNotMatch(controller, /window\.open\(/, '不再開外部瀏覽器');
  assert.match(read('js/views/scopeView.js'), /ui\.actions\.openSource\(r\.id, q\)/);
  const dialog = read('js/components/judgmentDialog.js');
  assert.match(dialog, /judgment-hit/);
  assert.match(read('index.html'), /js\/components\/judgmentDialog\.js/);
  assert.match(read('../main/preload.ts'), /judgmentText: \(args: unknown\) => invoke\('scope:judgmentText', args\)/);
});
