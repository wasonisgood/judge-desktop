// 畫面冒煙測試：以 Electron 啟動真正的主程序，在畫面上操作並檢查結果，最後截圖。
// 執行：npx electron scripts/ui-smoke.cjs   （需先 npm run build）
// 不會呼叫外部 AI 服務（未設定金鑰時，助理會回報「尚未設定金鑰」，這本身也是要檢查的路徑）。
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
const shotDir = process.env.UI_SMOKE_DIR || path.join(process.cwd(), 'ui-smoke-out');

require('../dist/main/main.js');

async function waitWindow() {
  for (let i = 0; i < 100; i++) {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('視窗沒有載入');
}

const js = (w, code) => w.webContents.executeJavaScript(code);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const w = await waitWindow();
    await wait(800);

    // 1. 首頁預設可見
    check('首頁預設可見', await js(w, "document.getElementById('page-home').classList.contains('active')"));

    // 2. 側欄切換：各頁都能切到
    for (const page of ['list', 'scope', 'brief', 'files', 'settings', 'home']) {
      await js(w, `document.querySelector('.rail-item[data-page="${page}"]').click()`);
      await wait(120);
      const active = await js(w, `document.querySelector('.page.active').id`);
      check(`側欄切到 ${page}`, active === `page-${page}`, active);
    }

    // 3. 範圍整理：自由輸入多行法規；空白時不送出
    await js(w, "document.querySelector('.rail-item[data-page=\"scope\"]').click()");
    await wait(100);
    await js(w, "document.getElementById('scopeLines').value = '國家賠償法\\n民法第184條第1項'");
    const lines = await js(w, "document.getElementById('scopeLines').value.split('\\n').length");
    check('範圍整理可輸入多行法規', lines === 2, String(lines));
    await js(w, "document.getElementById('scopeLines').value = ''; document.getElementById('scopeForm').dispatchEvent(new Event('submit',{cancelable:true}))");
    await wait(150);
    const scopeMsg = await js(w, "document.getElementById('scopeStatus').textContent");
    check('範圍整理空白時提示輸入法規', /請至少輸入一部法規/.test(scopeMsg), scopeMsg);

    // 4. 單一判決：未選定就不能整理
    await js(w, "document.querySelector('.rail-item[data-page=\"brief\"]').click()");
    await wait(100);
    const runDisabled = await js(w, "document.getElementById('briefRun').disabled");
    check('單一判決未選定時整理按鈕停用', runDisabled === true);

    // 5. 懸浮助理：開啟、收起
    await js(w, "document.getElementById('assistFab').click()");
    await wait(120);
    const openState = await js(w, "!document.getElementById('assistPanel').hidden");
    check('助理面板可開啟', openState === true);
    await js(w, "document.getElementById('assistClose').click()");
    await wait(120);
    const closed = await js(w, "document.getElementById('assistPanel').hidden");
    check('助理面板可收起', closed === true);

    // 6. 助理送出訊息（無金鑰）→ 顯示錯誤而不是卡住。若應用程式已存有金鑰，這項檢查不適用，明確標示略過。
    const hasKeyNow = await js(w, "window.api.settings.get().then(s => s.hasKey)");
    if (hasKeyNow) {
      check('無金鑰檢查略過（應用程式已設定金鑰）', true, 'hasKey=true');
    } else {
      await js(w, "document.getElementById('assistFab').click()");
      await js(w, "document.getElementById('assistText').value = '你好'; document.getElementById('assistForm').dispatchEvent(new Event('submit',{cancelable:true}))");
      await wait(1500);
      const assistText = await js(w, "[...document.querySelectorAll('.assist-msg.assistant .assist-text')].map(x=>x.textContent).pop()");
      check('無金鑰時助理顯示錯誤訊息', /金鑰|無法回應/.test(assistText || ''), (assistText || '').slice(0, 60));
      const sendEnabled = await js(w, "!document.getElementById('assistSend').disabled");
      check('助理送出後按鈕恢復可按', sendEnabled === true);
      await js(w, "document.getElementById('assistClear').click()");
    }

    // 7. 檔案頁：分頁切換不出錯
    await js(w, "document.querySelector('.rail-item[data-page=\"files\"]').click()");
    await wait(200);
    for (const tab of ['archived', 'trashed', 'active']) {
      await js(w, `document.querySelector('.tab[data-tab="${tab}"]').click()`);
      await wait(200);
      const on = await js(w, `document.querySelector('.tab.active').dataset.tab`);
      check(`檔案頁分頁切到 ${tab}`, on === tab, on);
    }
    const filesMsg = await js(w, "document.getElementById('filesStatus').textContent");
    check('檔案頁讀取沒有錯誤', !/讀取失敗/.test(filesMsg), filesMsg);

    // 8. 深色模式切換
    await js(w, "document.getElementById('themeToggle').click()");
    await wait(100);
    const dark = await js(w, "document.documentElement.getAttribute('data-theme')");
    check('深色模式可切換', dark === 'dark', dark);
    await js(w, "document.getElementById('themeToggle').click()");

    // 9. 設定：切到工作負載身分聯合，圖解步驟與欄位出現，金鑰欄位隱藏
    await js(w, "document.querySelector('.rail-item[data-page=\"settings\"]').click()");
    await wait(200);
    await js(w, "document.getElementById('setAuthMode').value='federation'; document.getElementById('setAuthMode').dispatchEvent(new Event('change'))");
    await wait(120);
    const fedShown = await js(w, "!document.getElementById('fedFields').hidden");
    const steps = await js(w, "document.querySelectorAll('.wif-step').length");
    const keyHidden = await js(w, "document.getElementById('keyField').hidden");
    check('身分聯合：顯示欄位與四步圖解', fedShown === true && steps === 4, String(steps));
    check('身分聯合：隱藏金鑰欄位', keyHidden === true);
    const svgCount = await js(w, "document.querySelectorAll('.wif-art').length");
    check('身分聯合：每一步都有 SVG 圖示', svgCount === 4, String(svgCount));
    await js(w, "document.getElementById('setAuthMode').value='apiKey'; document.getElementById('setAuthMode').dispatchEvent(new Event('change'))");
    await wait(80);
    const keyBack = await js(w, "!document.getElementById('keyField').hidden");
    check('切回 API 金鑰時金鑰欄位恢復', keyBack === true);
    await js(w, "document.getElementById('setAuthMode').value='federation'; document.getElementById('setAuthMode').dispatchEvent(new Event('change'))");

    // 9b. 判決列表與單一判決候選（只用法院搜尋，不耗 AI 額度）：檢查表格與截圖
    await js(w, "document.querySelector('.rail-item[data-page=\"list\"]').click()");
    await wait(150);
    await js(w, "document.getElementById('listKeyword').value = '戒嚴'; document.getElementById('listForm').dispatchEvent(new Event('submit',{cancelable:true}))");
    for (let i = 0; i < 60; i++) {
      const n = await js(w, "document.querySelectorAll('#listBody tr').length");
      if (n > 0 || i > 55) break;
      await wait(1000);
    }
    const listRows = await js(w, "document.querySelectorAll('#listBody tr').length");
    check('判決列表搜尋有結果列', listRows > 0, String(listRows));
    const listDateCell = await js(w, "document.querySelector('#listBody tr td:nth-child(3)') ? document.querySelector('#listBody tr td:nth-child(3)').textContent : ''");
    check('判決列表日期欄有值', /\d{4}-\d{2}-\d{2}/.test(listDateCell), listDateCell);
    await wait(200);
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'list-results.png'), (await w.webContents.capturePage()).toPNG());

    await js(w, "document.querySelector('.rail-item[data-page=\"brief\"]').click()");
    await wait(150);
    await js(w, "document.getElementById('briefQuery').value = '戒嚴'; document.getElementById('briefFindForm').dispatchEvent(new Event('submit',{cancelable:true}))");
    for (let i = 0; i < 60; i++) {
      const n = await js(w, "document.querySelectorAll('#briefCandidateBody tr').length");
      if (n > 0 || i > 55) break;
      await wait(1000);
    }
    await js(w, "document.querySelector('#briefCandidateBody tr button').click()");
    await wait(200);
    await js(w, "document.getElementById('briefCandidates').scrollIntoView()");
    await wait(200);
    fs.writeFileSync(path.join(shotDir, 'brief-candidates.png'), (await w.webContents.capturePage()).toPNG());
    const btnWrap = await js(w, "[...document.querySelectorAll('#briefCandidateBody button')].map(b => b.getBoundingClientRect().height)[0]");
    check('候選表「選定這則」按鈕單行（高度不超過 40px）', btnWrap <= 40, String(btnWrap));

    // 10. 真實 AI 實測（僅在提供 JUDGE_TEST_AI_KEY 時執行）：金鑰填入應用程式設定，在畫面上實際操作
    const aiKey = process.env.JUDGE_TEST_AI_KEY;
    if (aiKey) {
      const waitFor = (expr, ms) => w.webContents.executeJavaScript(
        `new Promise((res) => { const t0 = Date.now(); const timer = setInterval(() => { let v = false; try { v = !!(${expr}); } catch (e) {} if (v || Date.now() - t0 > ${ms}) { clearInterval(timer); res(v); } }, 500); })`
      );
      await js(w, `window.api.settings.set({ aiProvider: 'anthropic', aiAuthMode: 'apiKey', aiBaseUrl: 'https://api.anthropic.com', aiModel: 'claude-haiku-5-5', apiKey: ${JSON.stringify(aiKey)} })`);
      const test = await js(w, "window.api.settings.test().then(r => r.reply).catch(e => 'ERR:' + e.message)");
      check('AI 連線測試（畫面設定）', /OK/.test(test), String(test).slice(0, 40));

      // 範圍整理：實際輸入、送出、等待完成
      await js(w, "document.querySelector('.rail-item[data-page=\"scope\"]').click()");
      await wait(150);
      await js(w, "document.getElementById('scopeLines').value = '二二八事件處理及賠償條例'; document.getElementById('scopeMax').value = '2'; document.getElementById('scopeForm').dispatchEvent(new Event('submit',{cancelable:true}))");
      const scopeDone = await waitFor("/完成|失敗/.test(document.getElementById('scopeStatus').textContent)", 420000);
      const scopeStatus = await js(w, "document.getElementById('scopeStatus').textContent");
      check('範圍整理（真實 AI）完成', scopeDone && /完成/.test(scopeStatus), scopeStatus.slice(0, 60));
      const scopeRows = await js(w, "document.querySelectorAll('#scopeResult tbody tr').length");
      check('範圍整理表有判決列', scopeRows > 0, String(scopeRows));
      await js(w, "document.getElementById('scopeResult').scrollIntoView()");
      await wait(200);
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, 'live-scope.png'), (await w.webContents.capturePage()).toPNG());

      // 單一判決：找候選 → 選定 → 精讀
      await js(w, "document.querySelector('.rail-item[data-page=\"brief\"]').click()");
      await wait(150);
      await js(w, "document.getElementById('briefQuery').value = '戒嚴'; document.getElementById('briefFindForm').dispatchEvent(new Event('submit',{cancelable:true}))");
      const found = await waitFor("document.querySelectorAll('#briefCandidateBody tr').length > 0", 120000);
      check('單一判決：候選列出', found);
      await js(w, "document.querySelector('#briefCandidateBody tr button').click()");
      await wait(150);
      const picked = await js(w, "document.getElementById('briefRun').disabled === false");
      check('單一判決：選定後整理按鈕可按', picked === true);
      await js(w, "document.getElementById('briefForm').dispatchEvent(new Event('submit',{cancelable:true}))");
      const briefDone = await waitFor("!document.getElementById('briefView').hidden", 300000);
      const briefStatus = await js(w, "document.getElementById('briefStatus').textContent");
      check('單一判決精讀（真實 AI）完成', briefDone, briefStatus.slice(0, 120));
      await js(w, "document.getElementById('briefView').scrollIntoView()");
      await wait(200);
      fs.writeFileSync(path.join(shotDir, 'live-brief.png'), (await w.webContents.capturePage()).toPNG());

      // 助理：真實對話
      await js(w, "document.getElementById('assistFab').click()");
      await wait(150);
      await js(w, "document.getElementById('assistText').value = '請用一句話說明你能幫我做什麼'; document.getElementById('assistForm').dispatchEvent(new Event('submit',{cancelable:true}))");
      await waitFor("!document.getElementById('assistSend').disabled", 120000);
      const lastReply = await js(w, "[...document.querySelectorAll('.assist-msg.assistant .assist-text')].map(x=>x.textContent).pop()");
      check('助理（真實 AI）有回覆', !!lastReply && !/思考中|無法回應/.test(lastReply), (lastReply || '').slice(0, 50));
      fs.writeFileSync(path.join(shotDir, 'live-assistant.png'), (await w.webContents.capturePage()).toPNG());
    }

    // 截圖（首頁、範圍整理、助理面板）
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = async (name) => {
      const img = await w.webContents.capturePage();
      const file = path.join(shotDir, name);
      fs.writeFileSync(file, img.toPNG());
      return file;
    };
    await js(w, "document.querySelector('.rail-item[data-page=\"settings\"]').click()");
    await wait(200);
    await wait(300);
    await js(w, "if (!document.getElementById('assistPanel').hidden) document.getElementById('assistClose').click(); document.getElementById('setAuthMode').value='federation'; document.getElementById('setAuthMode').dispatchEvent(new Event('change'))");
    await wait(200);
    const sSet = await shot('settings-federation.png');
    await js(w, "document.querySelector('.rail-item[data-page=\"home\"]').click()");
    await wait(200);
    const s1 = await shot('home.png');
    await js(w, "document.querySelector('.rail-item[data-page=\"scope\"]').click(); if (document.getElementById('assistPanel').hidden) document.getElementById('assistFab').click()");
    await wait(300);
    const s2 = await shot('scope-with-assistant.png');
    check('截圖已儲存', fs.existsSync(s1) && fs.existsSync(s2), shotDir);
  } catch (e) {
    check('測試流程沒有例外', false, e.message);
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
  console.log(`\n共 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
  app.exit(failed.length ? 1 : 0);
});
