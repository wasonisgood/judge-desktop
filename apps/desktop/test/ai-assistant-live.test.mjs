// 助理的實際 AI 測試：真的呼叫模型，確認會選對工具，且會花費額度的操作只列為待確認。
// 需要 JUDGE_TEST_AI_KEY；可用 JUDGE_TEST_AI_PROVIDER（預設 anthropic）與 JUDGE_TEST_AI_MODEL。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runAssistantTurn } = require('../dist/main/assistant.js');

const KEY = process.env.JUDGE_TEST_AI_KEY;
const cfg = {
  provider: process.env.JUDGE_TEST_AI_PROVIDER ?? 'anthropic',
  baseUrl: process.env.JUDGE_TEST_AI_PROVIDER === 'openai-compatible' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com',
  model: process.env.JUDGE_TEST_AI_MODEL ?? 'claude-haiku-5-5',
  apiKey: KEY,
};

test('助理：要求整理法規時，提議範圍整理但不直接執行', { skip: !KEY && '未設定 JUDGE_TEST_AI_KEY', timeout: 180000 }, async () => {
  const executed = [];
  const turn = await runAssistantTurn(
    {
      config: async () => cfg,
      execute: async (call) => {
        executed.push(call.name);
        if (call.name === 'propose_scope') {
          return { content: '已提議，等待使用者按同意後執行。', pending: { id: 'p1', kind: 'run_scope', label: '範圍整理：' + call.input.statutes.join('、'), args: call.input } };
        }
        return { content: '[]' };
      },
    },
    [],
    '請幫我整理國家賠償法的判決範圍',
  );
  assert.ok(executed.includes('propose_scope'), '應該呼叫 propose_scope，實際：' + executed.join(','));
  assert.equal(turn.pending.length, 1);
  assert.ok(turn.reply.length > 0);
});

test('助理：要求開啟檔案頁時，直接切換頁面', { skip: !KEY && '未設定 JUDGE_TEST_AI_KEY', timeout: 180000 }, async () => {
  const turn = await runAssistantTurn(
    {
      config: async () => cfg,
      execute: async (call) => (call.name === 'open_page' ? { content: '已切換。', navigate: call.input.page } : { content: 'ok' }),
    },
    [],
    '請打開檔案頁',
  );
  assert.equal(turn.navigate, 'files');
});
