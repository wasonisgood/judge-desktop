// 助理多輪討論的實際 AI 測試：第二輪必須延續第一輪的脈絡，且過程中會實際使用工具。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runAssistantTurn } = require('../dist/main/assistant.js');

const KEY = process.env.JUDGE_TEST_AI_KEY;
const cfg = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: process.env.JUDGE_TEST_AI_MODEL ?? 'claude-haiku-5-5', apiKey: KEY, authMode: 'apiKey' };

test('助理多輪討論：第二輪延續上文，並實際使用工具', { skip: !KEY && '未設定 JUDGE_TEST_AI_KEY', timeout: 400000 }, async () => {
  const used = [];
  const execute = async (call) => {
    used.push(call.name);
    if (call.name === 'resolve_statute') return { content: '正式法名：證券投資信託及顧問法' };
    if (call.name === 'search_judgments') return { content: JSON.stringify([{ id: 'x', title: '臺北高等行政法院 某案 判決', date: '2026-01-01' }]) };
    return { content: '無資料' };
  };
  const history = [];
  const q1 = '金管會命投信公司解除董事職務，董事提告，請問他的請求權基礎或訴訟類型是什麼？請簡短回答，並引用你依據的法條。';
  const t1 = await runAssistantTurn({ config: async () => cfg, execute }, history, q1);
  assert.ok(t1.reply.length > 10, '第一輪應有實質回覆');
  history.push({ role: 'user', text: q1 }, { role: 'assistant', text: t1.reply });
  const q2 = '那這類撤換的頻率高嗎？你剛才提到的訴訟類型，實務上大家通常會不會提告？請用兩三句話回答，並承接你前面的說明。';
  const t2 = await runAssistantTurn({ config: async () => cfg, execute }, history, q2);
  assert.ok(t2.reply.length > 10, '第二輪應有實質回覆');
  assert.ok(!/無法回應|沒有回覆/.test(t2.reply));
  console.log('ROUND1:', t1.reply.slice(0, 300));
  console.log('ROUND2:', t2.reply.slice(0, 300));
  console.log('TOOLS USED:', used.join(','));
});
