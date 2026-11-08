// 進度診斷：單獨跑一次範圍整理，每秒記錄範圍整理頁的狀態文字與助理進度卡文字，找出最後留在畫面上的狀態。
// 執行：JUDGE_TEST_AI_KEY=... npx electron scripts/progress-probe.cjs
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
require('../dist/main/main.js');

app.whenReady().then(async () => {
  let w = null;
  for (let i = 0; i < 100 && !w; i++) { const x = BrowserWindow.getAllWindows()[0]; if (x && !x.webContents.isLoading()) w = x; else await wait(100); }
  await wait(800);
  const js = (c) => w.webContents.executeJavaScript(c);
  await js(`window.api.settings.set({ aiProvider: 'anthropic', aiAuthMode: 'apiKey', aiBaseUrl: 'https://api.anthropic.com', aiModel: 'claude-haiku-5-5', apiKey: ${JSON.stringify(process.env.JUDGE_TEST_AI_KEY)} })`);
  await js("document.querySelector('.rail-item[data-page=\"scope\"]').click()");
  await js("document.getElementById('scopeLines').value = '國家賠償法'; document.getElementById('scopeMax').value = '1'; document.getElementById('assistFab').click(); document.getElementById('scopeForm').dispatchEvent(new Event('submit',{cancelable:true}))");
  const t0 = Date.now();
  let last = '';
  for (let i = 0; i < 400; i++) {
    await wait(1000);
    const snap = await js(`JSON.stringify({ page: document.getElementById('scopeStatus').textContent, card: [...document.querySelectorAll('.assist-progress-text')].map(x=>x.textContent).pop() || '', head: [...document.querySelectorAll('.assist-progress strong')].map(x=>x.textContent).pop() || '', btnDisabled: document.getElementById('scopeRun').disabled })`);
    if (snap !== last) { console.log(String(Math.round((Date.now() - t0) / 1000)).padStart(4) + 's ' + snap); last = snap; }
    if (!JSON.parse(snap).btnDisabled && i > 3) { await wait(2500); const fin = await js(`JSON.stringify({ page: document.getElementById('scopeStatus').textContent, card: [...document.querySelectorAll('.assist-progress-text')].map(x=>x.textContent).pop() || '', head: [...document.querySelectorAll('.assist-progress strong')].map(x=>x.textContent).pop() || '' })`); console.log('FINAL ' + fin); break; }
  }
  app.exit(0);
});
