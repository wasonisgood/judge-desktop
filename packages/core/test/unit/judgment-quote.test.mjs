// 跳至原文的定位測試：依據在判決全文中的位置（找到、找不到、太短、空白差異、截斷區之後的依據）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateQuote, judgmentBodyText, judgmentHasBody } from '../../dist/index.js';

test('空白內頁（判決編號不存在時的內容）沒有原文：只有空段落標題也算沒有', () => {
  assert.equal(judgmentHasBody({ sections: { 內文: '' }, fullText: '' }), false);
  assert.equal(judgmentHasBody({ sections: {}, fullText: '   ' }), false);
  assert.equal(judgmentHasBody({ sections: { 主文: '上訴駁回。' }, fullText: '' }), true);
  assert.equal(judgmentHasBody({ sections: {}, fullText: '全文' }), true);
});

const BODY = '主文\n上訴駁回。\n\n理由\n原告依國家賠償法第二條第二項請求賠償，本院認為該請求應予駁回。';

test('找到：回傳的起訖位置正好是依據文字', () => {
  const q = '本院認為該請求應予駁回';
  const span = locateQuote(BODY, q);
  assert.ok(span, '應該找到');
  assert.equal(BODY.slice(span.start, span.end), q);
});

test('找到（空白與換行不同）：位置涵蓋原文中含換行的段落', () => {
  const span = locateQuote(BODY, '依國家賠償法第二條第二項請求賠償');
  assert.ok(span);
  const span2 = locateQuote(BODY, '上訴駁回。 理由');
  assert.ok(span2, '去除空白後應可比對');
  assert.match(BODY.slice(span2.start, span2.end), /上訴駁回。\n\n理由/);
});

test('找不到：回傳 null（不假裝定位）', () => {
  assert.equal(locateQuote(BODY, '法院認為被告應賠償一百萬元整'), null);
});

test('太短的依據不採信：少於 6 字回傳 null', () => {
  assert.equal(locateQuote(BODY, '駁回'), null);
});

test('judgmentBodyText 與 AI 驗證的原文同一格式：段落組成、沒有段落時用全文', () => {
  const d = { sections: { 主文: '上訴駁回。', 理由: '本院認為該請求應予駁回。' }, fullText: 'FULL' };
  assert.equal(judgmentBodyText(d), '【主文】\n上訴駁回。\n\n【理由】\n本院認為該請求應予駁回。');
  assert.equal(judgmentBodyText({ sections: {}, fullText: 'FULL' }), 'FULL');
});

test('AI 看不到的尾段（超過 14000 字）的依據，在完整原文中仍可定位', () => {
  const head = '前文。'.repeat(3000);
  const tail = '法院認為該請求應予駁回的理由於此詳述。';
  const text = judgmentBodyText({ sections: { 理由: head + tail }, fullText: '' });
  const span = locateQuote(text, tail);
  assert.ok(span);
  assert.equal(text.slice(span.start, span.end), tail);
});
