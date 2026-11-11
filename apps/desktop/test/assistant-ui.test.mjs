// 助理畫面操作測試：目錄清理（敏感值隱藏）、設值檢查、提供給模型的目錄文字，以及工具迴圈中畫面動作的收集。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ui = require('../dist/main/assistantUi.js');
const { runAssistantTurn } = require('../dist/main/assistant.js');

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

const raw = [
  { id: 'listKeyword', page: 'list', kind: 'text', label: '關鍵字', value: '戒嚴' },
  { id: 'listAi', page: 'list', kind: 'select', label: 'AI 來源', value: 'cloud', options: ['auto', 'local', 'cloud'] },
  { id: 'listRun', page: 'list', kind: 'button', label: '搜尋' },
  { id: 'setApiKey', page: 'settings', kind: 'text', label: 'API 金鑰', value: 'sk-SECRET-123' },
  { id: 'bad id!', page: 'list', kind: 'text', label: 'x' },
  { id: 'listKeyword', page: 'list', kind: 'text', label: '重複' },
  { id: 'nokind', page: 'list', kind: 'weird', label: 'x' },
];

test('目錄清理：丟棄非法與重複的 id，敏感欄位不帶值', () => {
  const c = ui.sanitizeControls(raw);
  assert.deepEqual(c.map((x) => x.id), ['listKeyword', 'listAi', 'listRun', 'setApiKey']);
  const key = c.find((x) => x.id === 'setApiKey');
  assert.equal(key.secret, true);
  assert.equal(key.value, undefined, '敏感欄位的值不得送給模型');
  assert.equal(JSON.stringify(c).includes('sk-SECRET-123'), false);
});

test('敏感判斷不誤判：關鍵字欄位可填，設定頁的金鑰欄位不可填', () => {
  assert.equal(ui.SECRET_RE.test('listKeyword'), false);
  assert.equal(ui.SECRET_RE.test('scopeKeyword'), false);
  assert.equal(ui.SECRET_RE.test('semKeyword'), false);
  assert.equal(ui.SECRET_RE.test('setKey'), true);
  assert.equal(ui.SECRET_RE.test('keyField'), true);
  assert.equal(ui.SECRET_RE.test('setApiKey'), true);
});

test('設值檢查：選項必須存在、勾選框只接受布林、按鈕與敏感欄位不可設值', () => {
  const c = ui.controlMap(ui.sanitizeControls(raw));
  assert.equal(ui.checkSetValue(c.get('listAi'), 'local').ok, true);
  assert.equal(ui.checkSetValue(c.get('listAi'), 'martian').ok, false);
  assert.equal(ui.checkSetValue(c.get('listRun'), 'x').ok, false);
  assert.equal(ui.checkSetValue(c.get('setApiKey'), 'x').ok, false);
  assert.equal(ui.checkSetValue(c.get('listKeyword'), 12).value, '12');
  const box = { id: 'chk', page: 'x', kind: 'checkbox', label: '勾選' };
  assert.equal(ui.checkSetValue(box, 'true').value, true);
  assert.equal(ui.checkSetValue(box, 'yes').ok, false);
  const num = { id: 'n', page: 'x', kind: 'number', label: '數字' };
  assert.equal(ui.checkSetValue(num, 'abc').ok, false);
});

test('目錄文字：目前頁面完整列出，其他頁面只有 id 與標籤，且不含敏感值', () => {
  const text = ui.controlsPrompt(ui.sanitizeControls(raw), 'list');
  assert.match(text, /目前頁面：list/);
  assert.match(text, /listAi（select，AI 來源.*選項：auto\|local\|cloud/);
  assert.match(text, /settings：setApiKey（API 金鑰）/);
  assert.equal(text.includes('sk-SECRET-123'), false);
});

test('工具迴圈：目錄進入系統提示；畫面動作與待確認項目依序收集', async () => {
  const bodies = [];
  let i = 0;
  const replies = [
    { content: [{ type: 'tool_use', id: 'a', name: 'ui_set', input: { id: 'listAi', value: 'local' } }, { type: 'tool_use', id: 'b', name: 'ui_click', input: { id: 'listRun' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '已把 AI 來源改為本地，並提議搜尋。' }], stop_reason: 'end_turn' },
  ];
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(replies[Math.min(i++, replies.length - 1)]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const cfg = async () => ({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'm', apiKey: 'k' });
  const controls = ui.sanitizeControls(raw);
  const turn = await runAssistantTurn(
    {
      config: cfg,
      execute: async (call, ctx) => {
        const c = ctx.controls.get(call.input.id);
        if (call.name === 'ui_set') {
          const v = ui.checkSetValue(c, call.input.value);
          return v.ok ? { content: 'ok', ui: { type: 'set', id: call.input.id, value: v.value } } : { content: v.reason };
        }
        return { content: '已提議', pending: { id: 'p1', kind: 'ui_click', label: `按下「${c.label}」`, args: { id: call.input.id } } };
      },
    },
    [],
    '把 AI 改成本地然後搜尋',
    { page: 'list', controls: controls },
  );
  assert.match(bodies[0].system, /控制項目錄/);
  assert.match(bodies[0].system, /listAi/);
  assert.deepEqual(turn.ui, [{ type: 'set', id: 'listAi', value: 'local' }]);
  assert.equal(turn.pending[0].kind, 'ui_click');
  assert.equal(turn.pending[0].label, '按下「搜尋」');
});

// 控制項 id 必須在所有頁面中唯一：助理以 id 定位控制項，重複會指到錯的元素。
test('控制項 id 在所有頁面模板中不重複', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'js', 'templates');
  const seen = new Map();
  const dups = [];
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/ id="([^"]+)"/g)) {
      if (seen.has(m[1]) && seen.get(m[1]) !== f) dups.push(`${m[1]}（${seen.get(m[1])} 與 ${f}）`);
      seen.set(m[1], f);
    }
  }
  assert.deepEqual(dups, []);
});

// 頁面動作（ui_action）的參數驗證：不認識的動作拒絕；標準與欄位與標注的參數被清理。
test('頁面動作：不認識的動作拒絕；必要參數缺漏時拒絕', () => {
  assert.equal(ui.checkUiAction('deleteEverything', {}).ok, false);
  assert.equal(ui.checkUiAction('pickCandidate', {}).ok, false);
  assert.equal(ui.checkUiAction('removeScopeField', { name: '  ' }).ok, false);
  assert.equal(ui.checkUiAction('annotateQuote', { quote: '' }).ok, false);
});

test('頁面動作：標準列只保留合法的列，AI 需描述、程式需關鍵字；空陣列拒絕', () => {
  const r = ui.checkUiAction('setCriteria', { criteria: [
    { kind: 'exclude', method: 'program', keywords: ['和解', ''] },
    { kind: 'include', method: 'ai', text: '原告為消費者' },
    { kind: 'include', method: 'ai', text: '' },
    { kind: 'weird', method: 'nope', text: '其他', keywordMode: 'all' },
  ] });
  assert.equal(r.ok, true);
  assert.equal(r.args.criteria.length, 3);
  assert.equal(r.args.criteria[0].keywords, '和解、');
  assert.equal(r.args.criteria[2].kind, 'include');
  assert.equal(ui.checkUiAction('setCriteria', { criteria: [{ method: 'ai', text: '' }] }).ok, false);
});

test('頁面動作：標注顏色不合法時改用黃色；候選與欄位參數正確', () => {
  const a = ui.checkUiAction('annotateQuote', { quote: '本院認為', color: 'purple' });
  assert.equal(a.ok, true);
  assert.equal(a.args.color, 'yellow');
  assert.deepEqual(ui.checkUiAction('pickCandidate', { id: 'TPSV_1' }).args, { id: 'TPSV_1' });
  assert.deepEqual(ui.checkUiAction('addScopeField', { name: '判決結果', description: '勝訴或敗訴' }).args, { name: '判決結果', description: '勝訴或敗訴' });
});

// 覆核與跳至原文、精讀列表：覆核改動資料，必須列為待確認；參數缺漏時拒絕。
test('覆核動作：改動資料的覆核一律需要確認；參數驗證', () => {
  assert.ok(ui.CONFIRM_UI_ACTIONS.includes('scopeReview'));
  assert.equal(ui.checkUiAction('scopeReview', { op: 'accept' }).ok, false, '缺少工作表與案件');
  const ok = ui.checkUiAction('scopeReview', { op: 'accept', sheetIndex: 0, caseId: 'A1', fieldId: 'f1' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.args, { op: 'accept', sheetIndex: 0, caseId: 'A1', fieldId: 'f1' });
  assert.equal(ui.checkUiAction('scopeReview', { op: 'edit', sheetIndex: 0, caseId: 'A1', fieldId: 'f1', value: '  ' }).ok, false);
  assert.equal(ui.checkUiAction('scopeReview', { op: 'batchAccept', sheetIndex: 2 }).ok, true);
  assert.equal(ui.checkUiAction('scopeReview', { op: 'undoLast' }).ok, true);
});

test('精讀列表與跳至原文：需要 id', () => {
  assert.equal(ui.checkUiAction('briefFromList', {}).ok, false);
  assert.equal(ui.checkUiAction('briefFromList', { id: 'TPSV_1' }).ok, true);
  assert.equal(ui.checkUiAction('scopeOpenSource', { quote: '本院' }).ok, false);
});

// 主程序允許的每個頁面動作，渲染端的分派（aiBridge.runAction）都必須有對應的處理，避免兩邊漂移。
test('頁面動作：主程序允許的每個動作，渲染端都有分派', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const bridge = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'js', 'core', 'aiBridge.js'), 'utf8');
  for (const name of ui.UI_ACTIONS) {
    assert.ok(bridge.includes(`name === '${name}'`), `aiBridge.runAction 缺少 ${name}`);
  }
});
