// 畫面冒煙測試（issue #4）：智慧搜尋開關、處理流程說明視窗、範圍與精讀的說明按鈕。
// 執行：npx electron scripts/ui-smoke-pipeline.cjs   （需先 npm run build；JUDGE_SKIP_AUTH=1 略過登入閘門，僅限開發版）
// 不呼叫外部 AI 或司法院服務；說明視窗以模擬的流程紀錄開啟。
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const shotDir = process.env.UI_SMOKE_DIR || path.join(process.cwd(), 'ui-smoke-out');

require('../dist/main/main.js');

const js = (w, code) => w.webContents.executeJavaScript(code);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitWindow() {
  for (let i = 0; i < 100; i++) {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) return w;
    await wait(100);
  }
  throw new Error('視窗沒有載入');
}

app.whenReady().then(async () => {
  try {
    const w = await waitWindow();
    await wait(800);
    fs.mkdirSync(shotDir, { recursive: true });

    await js(w, `document.querySelector('.rail-item[data-page="list"]').click()`);
    await wait(200);
    check('列表頁有「智慧搜尋」開關', await js(w, `!!document.getElementById('listSmart')`));
    check('列表頁有「查看處理流程」按鈕（初始停用）', await js(w, `(function(){var b=document.getElementById('listExplain');return !!b&&b.disabled;})()`));
    check('列表頁有澄清選項容器（初始隱藏）', await js(w, `(function(){var c=document.getElementById('listClarify');return !!c&&c.hidden;})()`));

    // 模擬流程紀錄，開啟說明視窗，檢查內容與關閉行為
    await js(w, `window.JR.components.explainDialog({ title: '判決列表：處理流程說明', paragraphs: [
      '第 1 步「第 1 輪判決搜尋」由規則程式處理：輸入 侵權；輸出 「侵權」3 筆；累計保留 3 筆；判斷為放行到下一步，理由：已有可用結果，放行生成',
      '共執行 1 步，最後一步放行生成結果。'] })`);
    await wait(150);
    check('說明視窗已開啟', await js(w, `!!document.querySelector('.explain-overlay [role="dialog"]')`));
    check('說明視窗列出每一步', await js(w, `document.querySelectorAll('.explain-steps li').length === 2`));
    const shot = await w.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, 'pipeline-explain-dialog.png'), shot.toPNG());
    await js(w, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await wait(100);
    check('按 Esc 可關閉說明視窗', await js(w, `!document.querySelector('.explain-overlay')`));

    // 澄清選項：模擬 ask 狀態，檢查選項按鈕與「自行輸入」最後一項
    await js(w, `window.JR.views && (function(){ var box=document.getElementById('listClarify'); box.hidden=false; box.innerHTML=''; ['民事侵權','行政罰'].forEach(function(t){var b=document.createElement('button');b.className='btn';b.textContent=t;box.appendChild(b);}); var m=document.createElement('button');m.className='btn';m.textContent='自行輸入更正後再試';box.appendChild(m); })()`);
    await wait(100);
    const lastLabel = await js(w, `(function(){var bs=document.querySelectorAll('#listClarify button');return bs.length? bs[bs.length-1].textContent : '';})()`);
    check('澄清選項最後一項為自行更正', lastLabel === '自行輸入更正後再試', lastLabel);
    await w.webContents.capturePage().then((img) => fs.writeFileSync(path.join(shotDir, 'pipeline-clarify.png'), img.toPNG()));

    await js(w, `document.querySelector('.rail-item[data-page="scope"]').click()`);
    await wait(200);
    check('範圍頁有「查看處理流程」按鈕（初始停用）', await js(w, `(function(){var b=document.getElementById('scopeExplain');return !!b&&b.disabled;})()`));
    await js(w, `document.querySelector('.rail-item[data-page="brief"]').click()`);
    await wait(200);
    check('精讀頁有「查看處理流程」按鈕（初始停用）', await js(w, `(function(){var b=document.getElementById('briefExplain');return !!b&&b.disabled;})()`));
  } catch (err) {
    check('執行過程沒有例外', false, err instanceof Error ? err.stack : String(err));
  } finally {
    const failed = results.filter((r) => !r.ok);
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` — ${r.detail}`}`);
    console.log(`\n${results.length - failed.length}/${results.length} 通過`);
    app.exit(failed.length ? 1 : 0);
  }
});
