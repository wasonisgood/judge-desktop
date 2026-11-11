// 研究設計對話測試：以假的 fetch 模擬 AI，確認 set_fields 會寫入欄位、對話紀錄會保存、試搜尋有次數上限。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSession, runDesignTurn, DESIGN_SEARCH_MAX } = require('../dist/main/designChat.js');

const realFetch = globalThis.fetch;
function mockFetch(responses) {
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const body = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}
test.after(() => { globalThis.fetch = realFetch; });

const cfg = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'm', apiKey: 'k' };
const deps = { config: cfg, search: async (q) => (q === '戒嚴' ? [{ title: '判決A' }, { title: '判決B' }] : []) };
const emptyEntry = () => ({ session: { ...createSession('想研究消費者訴訟'), turns: [] }, skipped: [] });

test('新設計：問題意識成為第一則使用者訊息，AI 可用 set_fields 寫入欄位並回覆', async () => {
  const calls = mockFetch([
    { content: [{ type: 'tool_use', id: 't1', name: 'set_fields', input: { subject: '消費者', yearFrom: 2018, yearTo: 2023 } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '已記下研究對象與期間，要比較哪一個變項？' }], stop_reason: 'end_turn' },
  ]);
  const { entry, result } = await runDesignTurn(deps, emptyEntry(), '想研究消費者訴訟');
  assert.equal(entry.session.slots.subject, '消費者');
  assert.equal(entry.session.slots.yearFrom, 2018);
  assert.equal(entry.session.slots.yearTo, 2023);
  assert.equal(entry.session.turns[0].role, 'user');
  assert.equal(entry.session.turns.at(-1).role, 'guide');
  assert.equal(result.reply, '已記下研究對象與期間，要比較哪一個變項？');
  assert.equal(result.actions.length, 1);
  assert.match(result.actions[0], /已寫入欄位：subject、yearFrom、yearTo/);
  assert.equal(calls.length, 2);
  // 第二次呼叫的訊息應包含工具結果
  assert.ok(JSON.stringify(calls[1].body.messages).includes('tool_result'));
});

test('set_fields 年份不合法時回報錯誤給模型，不寫入', async () => {
  mockFetch([
    { content: [{ type: 'tool_use', id: 't2', name: 'set_fields', input: { yearFrom: 18 } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '年份請用西元四位數。' }], stop_reason: 'end_turn' },
  ]);
  const { entry, result } = await runDesignTurn(deps, emptyEntry(), '2018 年以後');
  assert.equal(entry.session.slots.yearFrom, undefined);
  assert.equal(result.reply, '年份請用西元四位數。');
});

test('hand_off_scope：沒有法規時不切換頁面', async () => {
  mockFetch([
    { content: [{ type: 'tool_use', id: 't3', name: 'hand_off_scope', input: {} }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '請先告訴我要用哪一條法規。' }], stop_reason: 'end_turn' },
  ]);
  const { result } = await runDesignTurn(deps, emptyEntry(), '帶入範圍');
  assert.equal(result.navigate, null);
});

test('工具呼叫超過輪數上限時給出提示，不無限迴圈', async () => {
  const calls = mockFetch([
    { content: [{ type: 'tool_use', id: 'loop', name: 'set_fields', input: { question: '問題' } }], stop_reason: 'tool_use' },
  ]);
  const { result } = await runDesignTurn(deps, emptyEntry(), '一直問');
  assert.match(result.reply, /次數已達上限/);
  assert.equal(calls.length, 6);
  assert.equal(DESIGN_SEARCH_MAX, 3);
});
