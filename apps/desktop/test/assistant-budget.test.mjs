// 助理搜尋預算與搜尋方式（issue #4 第 2、5、6 點）：同一輪對話共用預算、傳統模式只搜一次、提示詞包含上限與選項指示。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runAssistantTurn, ASSISTANT_SEARCH_MAX } = require('../dist/main/assistant.js');

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

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

const anthropicCfg = async () => ({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'm', apiKey: 'k' });
const toolRound = (n) => ({ content: [{ type: 'tool_use', id: `t${n}`, name: 'search_judgments', input: { queries: [`關鍵字${n}`] } }], stop_reason: 'tool_use' });
const done = { content: [{ type: 'text', text: '完成。' }], stop_reason: 'end_turn' };

test('AI 模式：同一輪對話的所有工具呼叫共用同一個搜尋預算', async () => {
  mockFetch([toolRound(1), toolRound(2), toolRound(3), done]);
  const seen = [];
  await runAssistantTurn(
    { config: anthropicCfg, execute: async (_c, ctx) => { seen.push(ctx); return { content: '{}' }; } },
    [], '找判決',
  );
  assert.equal(seen.length, 3);
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[1], seen[2]);
  assert.equal(seen[0].budget.max, ASSISTANT_SEARCH_MAX);
  assert.equal(seen[0].searchMode, 'ai');
});

test('AI 模式：提示詞說明搜尋上限、結果不足與語意不清時的選項', async () => {
  const calls = mockFetch([done]);
  await runAssistantTurn({ config: anthropicCfg, execute: async () => ({ content: '' }) }, [], '問題');
  const system = calls[0].body.system;
  assert.match(system, new RegExp(`最多搜尋 ${ASSISTANT_SEARCH_MAX} 次`));
  assert.match(system, /自行輸入更正後再試/);
  assert.match(system, /候選解讀/);
  assert.doesNotMatch(system, /傳統搜尋模式/);
});

test('傳統模式：預算只有 1 次，提示詞要求只用原文搜尋', async () => {
  const calls = mockFetch([done]);
  let captured = null;
  await runAssistantTurn(
    { config: anthropicCfg, execute: async (_c, ctx) => { captured = ctx; return { content: '' }; } },
    [], '戒嚴補償',
    { searchMode: 'traditional' },
  );
  assert.equal(captured, null); // 沒有工具呼叫，因此沒有執行 ctx
  assert.match(calls[0].body.system, /傳統搜尋模式/);
  assert.match(calls[0].body.system, /只搜尋一次/);
});

test('傳統模式：工具呼叫收到的 ctx 帶有原文與單次預算', async () => {
  mockFetch([toolRound(1), done]);
  let ctxSeen = null;
  await runAssistantTurn(
    { config: anthropicCfg, execute: async (_c, ctx) => { ctxSeen = ctx; return { content: '{}' }; } },
    [], '戒嚴補償',
    { searchMode: 'traditional' },
  );
  assert.equal(ctxSeen.searchMode, 'traditional');
  assert.equal(ctxSeen.budget.max, 1);
  assert.equal(ctxSeen.userText, '戒嚴補償');
});
