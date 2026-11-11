// 覆核畫面的靜態接線檢查：控制器與視圖用到的元素 id、覆核操作與設定欄位都必須接上（不需要啟動 Electron）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ids = (src) => new Set([...src.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const scopeController = read('js/controllers/scope.js');
const scopeView = read('js/views/scopeView.js');
const settingsController = read('js/controllers/settings.js');
const settingsView = read('js/views/settingsView.js');
const settingsTemplate = read('js/templates/settingsPage.js');
const preload = read('../main/preload.ts');

test('覆核操作全部接上：視圖呼叫的每個 action 都由控制器提供', () => {
  const used = new Set([...scopeView.matchAll(/ui\.actions\.(\w+)/g)].map((m) => m[1]));
  assert.ok(used.size >= 9, '視圖應使用接受、修改、駁回、批次、還原、篩選等操作');
  for (const name of used) {
    assert.match(scopeController, new RegExp(`\\b${name}\\s*:\\s*function|function\\s+${name}\\s*\\(`), `控制器缺少 action ${name}`);
  }
});

test('覆核經由主程序 scope:review 套用，預載入口已註冊', () => {
  assert.match(scopeController, /api\.scope\.review\(/);
  assert.match(preload, /review: \(args: unknown\) => invoke\('scope:review', args\)/);
});

test('結果頁提供待覆核篩選、批次接受、還原上一步與依據跳至原文', () => {
  for (const s of ['待覆核', '批次接受高信心結果', '還原上一步', '跳至原文', '接受', '修改', '駁回', '還原此欄']) {
    assert.ok(scopeView.includes(s), `視圖缺少「${s}」`);
  }
  assert.match(scopeController, /api\.scope\.judgmentText\(/);
});

test('檔案頁開啟舊結果時會帶入項目 id，覆核狀態才能寫回', () => {
  // 呼叫鏈：檔案頁 → scope.showSaved(payload, 項目 id) → scope.showResult(…, libraryId) → 記住 scopeLibraryId（覆核寫回用）。
  assert.match(read('js/controllers/files.js'), /showSaved\(p, it\.id\)/);
  assert.match(scopeController, /showSaved: function \(p, libraryId\)[\s\S]*?showResult\(p\.sheets \|\| \[\], p\.yearFrom, p\.yearTo, libraryId\)/);
  assert.match(scopeController, /showResult: function \(sheets, from, to, libraryId\)[\s\S]*?state\.scopeLibraryId = libraryId \|\| null/);
});

test('設定頁的覆核門檻欄位存在、有讀寫，且控制器用到的 id 都在模板中', () => {
  const tplIds = ids(settingsTemplate);
  for (const id of ['setReviewMinEvidence', 'setReviewMaxDropped']) {
    assert.ok(tplIds.has(id), `設定模板缺少 ${id}`);
    assert.match(settingsView, new RegExp(`\\$\\('${id}'\\)`));
    assert.match(settingsController, new RegExp(`\\$\\('${id}'\\)`));
  }
  // 設定控制器也用到其他頁面的元素（例如精讀欄位），這裡只檢查設定頁自己的 set 開頭欄位。
  const used = new Set([...settingsController.matchAll(/\$\('(set[A-Za-z0-9]*)'\)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !tplIds.has(id));
  assert.deepEqual(missing, [], `設定控制器用到模板沒有的 id：${missing.join('、')}`);
});
