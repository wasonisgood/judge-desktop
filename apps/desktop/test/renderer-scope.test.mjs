// 範圍頁（標編碼標注工序）的靜態接線檢查：控制器與視圖用到的元素 id，都必須存在於頁面模板中；
// 腳本都要列在 index.html 裡。不需要啟動 Electron（實際操作另由 scripts/ui-smoke.cjs 執行）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 共用畫面的來源在 @judge/ui（與桌面端的 index.html 等入口檔並存）；優先讀共用來源，找不到再讀桌面端。
const uiSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@judge', 'ui', 'src');
const deskRenderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const resolveRenderer = (rel) => (fs.existsSync(path.join(uiSrc, rel)) ? path.join(uiSrc, rel) : path.join(deskRenderer, rel));
const read = (rel) => fs.readFileSync(resolveRenderer(rel), 'utf8');

const template = read('js/templates/scopePage.js');
const templateIds = new Set([...template.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const scopeController = read('js/controllers/scope.js');
const scopeView = read('js/views/scopeView.js');
const assistantController = read('js/controllers/assistant.js');

test('範圍頁控制器與視圖用到的元素 id 都存在於頁面模板', () => {
  const used = new Set();
  for (const src of [scopeController, scopeView]) {
    for (const m of src.matchAll(/\$\('([A-Za-z][A-Za-z0-9]*)'\)/g)) used.add(m[1]);
  }
  // 以字串傳給 setGate／setMsg 等輔助函式的 id 也要檢查。
  for (const m of scopeController.matchAll(/'(scope[A-Za-z]+)'/g)) used.add(m[1]);
  const missing = [...used].filter((id) => !templateIds.has(id));
  assert.deepEqual(missing, [], `模板缺少的 id：${missing.join('、')}`);
});

test('助理的待確認範圍整理會填入關鍵字、相關法規、只保留相關與智慧搜尋欄位', () => {
  for (const id of ['scopeLines', 'scopeKeyword', 'scopeRelated', 'scopeRelatedOnly', 'scopeSmart']) {
    assert.ok(templateIds.has(id), `模板缺少 ${id}`);
    assert.match(assistantController, new RegExp(`\\$\\('${id}'\\)`), `助理controller未設定 ${id}`);
  }
});

test('分析欄位列與上下移、移除按鈕的元件存在，並在 index.html 載入', () => {
  // 腳本現在由共用畫面的載入清單（order.txt）列出。
  const index = fs.readFileSync(path.join(uiSrc, '..', 'order.txt'), 'utf8');
  assert.match(index, /js\/components\/codingFieldRow\.js/);
  assert.match(read('js/components/codingFieldRow.js'), /coding-field-actions/);
  assert.match(scopeController, /\.coding-field-row/);
});

test('導覽列與首頁使用新名稱「標編碼標注工序」', () => {
  assert.match(read('index.html'), /標編碼標注工序/);
  assert.match(read('js/templates/homePage.js'), /標編碼標注工序/);
});
