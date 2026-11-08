// 助理工具迴圈測試：以假的 fetch 模擬 AI 服務，確認查詢工具會執行、會花費額度的操作只會列為待確認。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runAssistantTurn, isProposeTool } = require('../dist/main/assistant.js');

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

const anthropicCfg = async () => ({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'm', apiKey: 'k' });

test('Anthropic：查詢工具會執行，最後回覆文字', async () => {
  const calls = mockFetch([
    { content: [{ type: 'tool_use', id: 'tu1', name: 'search_judgments', input: { query: '戒嚴' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '找到 2 筆。' }], stop_reason: 'end_turn' },
  ]);
  const executed = [];
  const turn = await runAssistantTurn(
    { config: anthropicCfg, execute: async (c) => { executed.push(c.name); return { content: '[{"id":"x"}]' }; } },
    [],
    '找戒嚴的判決',
  );
  assert.deepEqual(executed, ['search_judgments']);
  assert.equal(turn.reply, '找到 2 筆。');
  assert.equal(turn.pending.length, 0);
  // 第二次請求必須帶上工具結果
  const second = calls[1].body.messages;
  const last = second[second.length - 1];
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 'tu1');
  // 請求中要宣告工具
  assert.ok(calls[0].body.tools.some((t) => t.name === 'propose_scope'));
});

test('提議的範圍整理會列為待確認，不會直接執行', async () => {
  mockFetch([
    { content: [{ type: 'tool_use', id: 'tu2', name: 'propose_scope', input: { statutes: ['國家賠償法'], yearFrom: 2000 } }] },
    { content: [{ type: 'text', text: '已提議，請確認。' }] },
  ]);
  const turn = await runAssistantTurn(
    {
      config: anthropicCfg,
      execute: async (c) => {
        assert.ok(isProposeTool(c.name));
        return { content: '已提議，等待使用者按同意後執行。', pending: { id: 'p1', kind: 'run_scope', label: '範圍整理：國家賠償法', args: { statutes: ['國家賠償法'], yearFrom: 2000 } } };
      },
    },
    [],
    '幫我整理國家賠償法',
  );
  assert.equal(turn.pending.length, 1);
  assert.equal(turn.pending[0].kind, 'run_scope');
  assert.deepEqual(turn.pending[0].args.statutes, ['國家賠償法']);
});

test('OpenAI 相容：工具呼叫的參數以字串傳回，需要解析', async () => {
  const calls = mockFetch([
    {
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'open_page', arguments: '{"page":"files"}' } }] } }],
    },
    { choices: [{ message: { role: 'assistant', content: '已切換到檔案頁。' } }] },
  ]);
  const cfg = async () => ({ provider: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'k' });
  const turn = await runAssistantTurn(
    { config: cfg, execute: async (c) => ({ content: '已切換。', navigate: c.input.page }) },
    [{ role: 'user', text: '前一句' }, { role: 'assistant', text: '前一則回覆' }],
    '打開檔案',
  );
  assert.equal(turn.navigate, 'files');
  assert.equal(turn.reply, '已切換到檔案頁。');
  // 第二次請求中，工具結果要用 role: tool
  const msgs = calls[1].body.messages;
  assert.equal(msgs[msgs.length - 1].role, 'tool');
  assert.equal(msgs[msgs.length - 1].tool_call_id, 'c1');
});

test('工具呼叫超過上限時會停止並說明', async () => {
  mockFetch([{ content: [{ type: 'tool_use', id: 'loop', name: 'open_page', input: { page: 'home' } }] }]);
  const turn = await runAssistantTurn(
    { config: anthropicCfg, execute: async () => ({ content: 'ok' }) },
    [],
    '無限循環',
  );
  assert.match(turn.reply, /上限/);
});

test('isProposeTool：只有兩種會花費額度的操作', () => {
  assert.equal(isProposeTool('propose_scope'), true);
  assert.equal(isProposeTool('propose_brief'), true);
  assert.equal(isProposeTool('delete_everything'), false);
});

test('多組關鍵字的結果合併：依字號去重、保留順序、限制筆數', () => {
  const { mergeSearchHits } = require('../dist/main/assistant.js');
  const a = [{ id: '1', title: 'A', date: null, cause: '' }, { id: '2', title: 'B', date: null, cause: '' }];
  const b = [{ id: '2', title: 'B', date: null, cause: '' }, { id: '3', title: 'C', date: null, cause: '' }];
  const merged = mergeSearchHits([a, b], 20);
  assert.deepEqual(merged.map((h) => h.id), ['1', '2', '3']);
  assert.equal(mergeSearchHits([a, b], 2).length, 2);
});
