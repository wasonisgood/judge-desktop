// 自然語言輸入測試：關鍵字不呼叫 AI；自然語言才呼叫一次 AI，且欄位經過清理。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { looksNatural, interpretInput, sanitizeNlFields } = require('../dist/main/services/nlIntent.js');

test('關鍵字（短詞、以空白分隔）判為關鍵字', () => {
  assert.equal(looksNatural('戒嚴 回復原狀'), false);
  assert.equal(looksNatural('國家賠償法'), false);
  assert.equal(looksNatural('高院 戒嚴'), false);
  assert.equal(looksNatural(''), false);
});

test('自然語言（口語、疑問、句末問號）判為自然語言', () => {
  assert.equal(looksNatural('我想找戒嚴時期的補償判決'), true);
  assert.equal(looksNatural('有沒有關於租賃契約提前終止的判決？'), true);
  assert.equal(looksNatural('幫我整理國家賠償法第2條的案例'), true);
});

test('關鍵字不呼叫 AI', async () => {
  let called = 0;
  const r = await interpretInput(async () => { called += 1; return '{}'; }, 'list', '戒嚴 回復原狀');
  assert.equal(r.mode, 'keyword');
  assert.deepEqual(r.fields, {});
  assert.equal(called, 0);
});

test('自然語言呼叫一次 AI，欄位只保留該頁認得的鍵', async () => {
  let system = '';
  const r = await interpretInput(
    async () => async (sys) => { system = sys; return '```json\n{"keyword":"戒嚴 補償","statute":"國家賠償法","smart":true,"evil":"x"}\n```'; },
    'list',
    '我想找戒嚴時期的補償判決',
  );
  assert.equal(r.mode, 'natural');
  assert.deepEqual(r.fields, { keyword: '戒嚴 補償', statute: '國家賠償法', smart: true });
  assert.match(system, /keyword/);
});

test('AI 沒有整理出欄位時明確報錯，不退回猜測', async () => {
  await assert.rejects(
    interpretInput(async () => async () => '{}', 'brief', '我想找一些判決？'),
    /沒有整理出可用的欄位/,
  );
});

test('sanitize：布林值只接受 true，字串去除空白', () => {
  assert.deepEqual(sanitizeNlFields('list', { keyword: '  租賃 ', smart: 'yes', statute: '   ' }), { keyword: '租賃' });
  assert.deepEqual(sanitizeNlFields('brief', { query: '高院 戒嚴', keyword: 'x' }), { query: '高院 戒嚴' });
});
