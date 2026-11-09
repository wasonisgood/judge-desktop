import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_RULES } from '../../dist/index.js';

// Ollama 模型名稱格式：name[:tag]，name 為小寫字母、數字、點、底線、連字號。
const OLLAMA_NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*:[a-z0-9][a-z0-9._-]*$/;

test('分級表中每個模型名稱都符合 Ollama 名稱格式', () => {
  for (const tier of ['light', 'standard', 'heavy']) {
    const t = BUILTIN_RULES.tiers[tier];
    assert.match(t.judgment, OLLAMA_NAME, `${tier}.judgment`);
    assert.match(t.chat, OLLAMA_NAME, `${tier}.chat`);
  }
});

test('每個等級都有精讀與回答模型，且 rulesVersion 已遞增', () => {
  for (const tier of ['light', 'standard', 'heavy']) {
    assert.ok(BUILTIN_RULES.tiers[tier].judgment.length > 0, `${tier} 缺少精讀模型`);
    assert.ok(BUILTIN_RULES.tiers[tier].chat.length > 0, `${tier} 缺少回答模型`);
  }
  assert.ok(BUILTIN_RULES.rulesVersion >= 2);
});
