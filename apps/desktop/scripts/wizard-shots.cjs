// 本地模組視窗的畫面截圖（不安裝任何東西）：逐一切換各個畫面並截圖，檢查版面與文字。
// 執行：npx electron scripts/wizard-shots.cjs   （需先 npm run build）
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const outDir = process.env.WIZ_SHOT_DIR || path.join(__dirname, '..', '..', '..', 'docs', 'testing', 'wizard-ui');
fs.mkdirSync(outDir, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'judge-wizui-')));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => { results.push({ name: n, ok: !!ok, detail: String(d) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + String(d).slice(0, 200) + ']' : ''}`); };
const js = (w, c) => w.webContents.executeJavaScript(c);
async function waitFor(w, expr, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await js(w, expr)) return true; } catch {} await wait(300); } return false; }
async function shot(w, name) { await wait(400); fs.writeFileSync(path.join(outDir, name), (await w.webContents.capturePage()).toPNG()); }
const findWizard = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('wizard.html'));
const findMain = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'));

require('../dist/main/main.js');
app.whenReady().then(async () => {
  try {
    let main = null;
    for (let i = 0; i < 100 && !main; i++) { main = findMain(); if (!main || main.webContents.isLoading()) { main = null; await wait(150); } }
    await wait(800);
    await js(main, `document.querySelector('.rail-item[data-page="settings"]').click()`);
    await wait(300);
    await shot(main, '00-設定頁-摘要.png');
    await js(main, `document.getElementById('openWizard').click()`);
    let wz = null;
    for (let i = 0; i < 60 && !wz; i++) { wz = findWizard(); if (!wz || wz.webContents.isLoading()) { wz = null; await wait(250); } }
    if (!wz) throw new Error('精靈沒有開啟');
    await wait(1200);
    await shot(wz, '01-檢查電腦-初始.png');
    await js(wz, `document.getElementById('btnCheck').click()`);
    const gotChoose = await waitFor(wz, `!document.querySelector('.wiz-view[data-view="choose"]').hidden`, 120000);
    if (!gotChoose) console.log('checkMsg=', await js(wz, `document.getElementById('checkMsg').textContent`));
    check('檢查後進入選擇方案', gotChoose);
    await wait(400);
    await shot(wz, '02-選擇方案.png');
    const cards = await js(wz, `document.querySelectorAll('.wiz-option').length`);
    check('方案卡片至少 2 張', cards >= 2, cards);
    await js(wz, `document.getElementById('btnToAgree').click()`);
    await waitFor(wz, `!document.querySelector('.wiz-view[data-view="agree"]').hidden`, 5000);
    await shot(wz, '03-同意安裝.png');
    await js(wz, `document.querySelector('.wiz-nav[data-view="install"]').click()`);
    await wait(400);
    await shot(wz, '04-安裝與註冊-待開始.png');
    await js(wz, `document.querySelector('.wiz-nav[data-view="diag"]').click()`);
    check('排除問題頁完成檢查', await waitFor(wz, `document.getElementById('diagSummary').textContent && !/檢查中/.test(document.getElementById('diagSummary').textContent)`, 180000));
    await wait(500);
    await shot(wz, '05-排除問題.png');
    await js(wz, `document.querySelector('.wiz-nav[data-view="modules"]').click()`);
    await wait(800);
    await shot(wz, '06-模組與更新.png');
    // 版面檢查：內容不應超出視窗寬度（無水平捲動）
    for (const v of ['check', 'choose', 'agree', 'install', 'diag', 'modules']) {
      await js(wz, `document.querySelector('.wiz-nav[data-view="${v}"]').click()`);
      await wait(200);
      const overflow = await js(wz, `(() => { const m = document.querySelector('.wiz-main'); return m.scrollWidth - m.clientWidth; })()`);
      check(`版面無水平溢出：${v}`, overflow <= 2, overflow);
    }
    const titlebar = await js(wz, `!!document.querySelector('.titlebar .win-controls')`);
    check('精靈使用與主畫面相同的自訂標題列', titlebar);
  } catch (e) {
    check('截圖流程例外', false, e && e.stack || e);
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);
  app.exit(failed.length ? 1 : 0);
});
