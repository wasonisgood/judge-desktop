// AI 助理完整流程（真實 AI，從輸入開始）：每一步都截圖，編號保存，供教學影片使用。
// 執行：JUDGE_TEST_AI_KEY=... npx electron scripts/ai-flow.cjs
// 流程：開啟助理 → 查判決 → 提議範圍整理 → 同意執行 → 討論結果 → 切換頁面 → 提議精讀 → 同意執行。
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const outDir = process.env.AI_FLOW_DIR || path.join(process.cwd(), 'ai-flow-out');
const KEY = process.env.JUDGE_TEST_AI_KEY;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

require('../dist/main/main.js');

app.whenReady().then(async () => {
  let w = null;
  for (let i = 0; i < 100 && !w; i++) { const x = BrowserWindow.getAllWindows()[0]; if (x && !x.webContents.isLoading()) w = x; else await wait(100); }
  if (!w) { console.log('視窗沒有載入'); app.exit(1); return; }
  await wait(800);
  fs.mkdirSync(outDir, { recursive: true });
  let step = 0;
  const js = (code) => w.webContents.executeJavaScript(code);
  const shot = async (label) => {
    await wait(1500);
    w.webContents.invalidate();
    await wait(400);
    step++;
    const file = path.join(outDir, `${String(step).padStart(2, '0')}-${label}.png`);
    fs.writeFileSync(file, (await w.webContents.capturePage()).toPNG());
    console.log('  shot', path.basename(file));
  };
  const waitFor = (expr, ms) => w.webContents.executeJavaScript(
    `new Promise((res) => { const t0 = Date.now(); const t = setInterval(() => { let v = false; try { v = !!(${expr}); } catch (e) {} if (v || Date.now() - t0 > ${ms}) { clearInterval(t); res(v); } }, 400); })`);
  const lastAssist = () => js("[...document.querySelectorAll('.assist-msg.assistant .assist-text')].map(x=>x.textContent).pop() || ''");
  const sendAssist = async (text, timeoutMs = 240000) => {
    const before = await js("document.querySelectorAll('.assist-msg.assistant').length");
    await js(`document.getElementById('assistText').value = ${JSON.stringify(text)}; document.getElementById('assistForm').dispatchEvent(new Event('submit',{cancelable:true}))`);
    await waitFor(`document.querySelectorAll('.assist-msg.assistant').length > ${before} && !document.getElementById('assistSend').disabled && ![...document.querySelectorAll('.assist-msg.assistant .assist-text')].pop().textContent.includes('思考中')`, timeoutMs);
    await wait(300);
    return lastAssist();
  };

  try {
    // 0. 設定：填入金鑰、限制範圍整理的筆數（示範用，縮短時間）
    await js(`window.api.settings.set({ aiProvider: 'anthropic', aiAuthMode: 'apiKey', aiBaseUrl: 'https://api.anthropic.com', aiModel: 'claude-haiku-5-5', apiKey: ${JSON.stringify(KEY)} })`);
    await js("document.querySelector('.rail-item[data-page=\"home\"]').click()");
    await wait(300);
    await shot('首頁');

    // 1. 開啟助理
    await js("document.getElementById('assistFab').click()");
    await wait(300);
    check('步驟1：開啟助理面板', await js("!document.getElementById('assistPanel').hidden"));
    await shot('開啟助理');

    // 2. 查判決（AI 應呼叫 search_judgments）
    const r2 = await sendAssist('請幫我搜尋「戒嚴」相關的判決，列出前三筆的字號。');
    check('步驟2：AI 查到判決並回覆', r2.length > 10 && !/無法回應/.test(r2), r2.slice(0, 40));
    await shot('AI查詢判決');

    // 3. 提議範圍整理（AI 應只提議、不直接執行）
    const scopeCardsBefore = await js("document.querySelectorAll('.assist-confirm').length");
    await sendAssist('請幫我整理「國家賠償法」的判決範圍，我要看引用它的判決。請先提議，等我同意。');
    await waitFor(`document.querySelectorAll('.assist-confirm').length > ${scopeCardsBefore}`, 60000);
    const cardCount = await js("document.querySelectorAll('.assist-confirm').length");
    check('步驟3：AI 提議範圍整理，列為待確認（未直接執行）', cardCount > scopeCardsBefore, `cards ${cardCount}`);
    const scopeNotRun = await js("document.getElementById('scopeStatus').textContent.indexOf('整理中') < 0");
    check('步驟3：提議時尚未開始執行', scopeNotRun === true);
    await js("document.getElementById('scopeMax') && (document.getElementById('scopeMax').value = '2')");
    await shot('AI提議範圍整理待確認');

    // 4. 同意執行 → 範圍整理在畫面上完成
    await js("[...document.querySelectorAll('.assist-confirm')].pop().querySelector('.btn.primary').click()");
    await wait(300);
    await shot('同意後開始執行');
    const scopeDone = await waitFor("/完成|失敗/.test(document.getElementById('scopeStatus').textContent)", 600000);
    const scopeStatus = await js("document.getElementById('scopeStatus').textContent");
    check('步驟4：同意後範圍整理完成', scopeDone && /完成/.test(scopeStatus), scopeStatus.slice(0, 50));
    await shot('範圍整理完成');

    // 5. 討論結果（AI 應能接續上文）
    const r5 = await sendAssist('剛才整理出來的判決，第一則大概在講什麼？請用兩三句話說明，並說明它引用國家賠償法的哪一條。');
    check('步驟5：AI 針對結果討論並回覆', r5.length > 15 && !/無法回應/.test(r5), r5.slice(0, 40));
    await shot('AI討論結果');

    // 6. 切換頁面（AI 應呼叫 open_page）
    await sendAssist('請幫我打開「檔案」頁面。');
    await waitFor("document.querySelector('.page.active') && document.querySelector('.page.active').id === 'page-files'", 30000);
    check('步驟6：AI 切換到檔案頁', await js("document.querySelector('.page.active').id") === 'page-files');
    await shot('AI切換到檔案頁');

    // 7. 提議精讀（回到單一判決，AI 只提議）
    await js("document.getElementById('assistFab').click()");
    await wait(200);
    const briefCardsBefore = await js("document.querySelectorAll('.assist-confirm').length");
    await sendAssist('請幫我用 AI 精讀戒嚴相關的第一則判決，先提議，等我同意。', 240000);
    await waitFor(`document.querySelectorAll('.assist-confirm').length > ${briefCardsBefore}`, 60000);
    check('步驟7：AI 提議精讀，列為待確認', (await js("document.querySelectorAll('.assist-confirm').length")) > briefCardsBefore);
    await shot('AI提議精讀待確認');

    // 8. 同意執行精讀
    await js("[...document.querySelectorAll('.assist-confirm')].pop().querySelector('.btn.primary').click()");
    await wait(300);
    const briefDone = await waitFor("!document.getElementById('briefView').hidden", 300000);
    check('步驟8：同意後精讀完成', briefDone);
    await shot('精讀完成');
  } catch (e) {
    check('流程沒有例外', false, e.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
  app.exit(failed.length ? 1 : 0);
});
