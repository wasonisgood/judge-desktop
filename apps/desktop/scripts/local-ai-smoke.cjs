// 本地模組安裝精靈的實機煙霧測試：以 Electron 啟動真正的主程序，操作主視窗與獨立的精靈視窗，每一步截圖。
// 執行：npx electron scripts/local-ai-smoke.cjs   （需先 npm run build）
// 引擎使用本機模擬的 Ollama 服務（不會在這台電腦安裝任何東西）；爬取模組會實際連線司法院網站一次（唯讀）。
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const outDir = process.env.LOCAL_SMOKE_DIR || path.join(__dirname, '..', '..', '..', 'docs', 'testing', 'local-ai');
fs.mkdirSync(outDir, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'judge-smoke-ud-')));

// ---- 模擬的 Ollama 服務 ----
const fake = { tags: new Set(), failPulls: 0, pullCalls: 0 };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url === '/api/version') return json(res, { version: '0.5.1-smoke' });
    if (req.url === '/api/tags') return json(res, { models: [...fake.tags].map((name) => ({ name })) });
    if (req.url === '/api/pull') {
      fake.pullCalls++;
      if (fake.failPulls > 0) {
        fake.failPulls--;
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'simulated pull failure' }));
      }
      const model = JSON.parse(body || '{}').model;
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
      res.write(JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) + '\n');
      res.write(JSON.stringify({ status: 'downloading', completed: 100, total: 100 }) + '\n');
      res.write(JSON.stringify({ status: 'success' }) + '\n');
      fake.tags.add(model);
      return res.end();
    }
    if (req.url === '/api/chat') return json(res, { message: { content: 'OK' } });
    res.writeHead(404);
    res.end();
  });
});
function json(res, obj) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(w, expr, timeoutMs = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await w.webContents.executeJavaScript(expr)) return true;
    } catch { /* 頁面切換中 */ }
    await wait(300);
  }
  return false;
}

async function shot(w, name) {
  await wait(300);
  fs.writeFileSync(path.join(outDir, name), (await w.webContents.capturePage()).toPNG());
}

const findWizard = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('wizard.html'));
const findMain = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'));
const js = (w, code) => w.webContents.executeJavaScript(code);

async function openWizard(main) {
  await js(main, `document.getElementById('openWizard').click()`);
  for (let i = 0; i < 50; i++) {
    const wz = findWizard();
    if (wz && !wz.webContents.isLoading()) { await wait(400); return wz; }
    await wait(200);
  }
  throw new Error('精靈視窗沒有開啟');
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.JUDGE_OLLAMA_URL = `http://127.0.0.1:${server.address().port}`;
  require('../dist/main/main.js');

  let mainWin = null;
  for (let i = 0; i < 100 && !mainWin; i++) {
    mainWin = findMain();
    if (!mainWin || mainWin.webContents.isLoading()) { mainWin = null; await wait(100); }
  }
  if (!mainWin) throw new Error('主視窗沒有載入');
  await wait(800);

  // A. 設定頁只顯示摘要與開啟精靈的按鈕
  await js(mainWin, `document.querySelector('.rail-item[data-page="settings"]').click()`);
  await wait(300);
  await shot(mainWin, '01-設定頁-摘要與開啟精靈.png');
  check('設定頁有開啟精靈按鈕', await js(mainWin, `!!document.getElementById('openWizard')`));
  check('設定頁沒有內嵌安裝步驟（只有摘要）', await js(mainWin, `!document.getElementById('aiCheck')`));

  // B. 開啟獨立精靈視窗
  const wz = await openWizard(mainWin);
  check('精靈以獨立視窗開啟', !!wz && wz !== mainWin);
  await shot(wz, '02-精靈-步驟1-檢查.png');

  // C. 主視窗在精靈開啟時仍可操作（獨立性）
  await js(mainWin, `document.querySelector('.rail-item[data-page="list"]').click()`);
  await wait(200);
  const mainActive = await js(mainWin, `document.querySelector('.page.active').id`);
  check('精靈開啟時主視窗仍可切換頁面', mainActive === 'page-list', mainActive);
  await js(mainWin, `document.querySelector('.rail-item[data-page="settings"]').click()`);

  // D. 步驟 1：檢查
  await js(wz, `document.getElementById('btnCheck').click()`);
  const choose = await waitFor(wz, `!document.getElementById('s-choose').hidden`, 90_000);
  check('步驟 1 檢查完成並進入選擇方案', choose);
  await shot(wz, '03-精靈-步驟2-選擇方案.png');
  const hasInstallable = await js(wz, `[...document.querySelectorAll('input[name="aiChoice"]')].some(i => i.value !== 'skip')`);
  check('這台電腦符合本地 AI 最低需求', hasInstallable);
  if (!hasInstallable) throw new Error('此電腦不符合安裝條件，無法完成安裝測試');

  // E. 步驟 2 → 3：選方案、同意
  await js(wz, `[...document.querySelectorAll('input[name="aiChoice"]')].find(i => i.value !== 'skip').click()`);
  await js(wz, `document.getElementById('btnToAgree').click()`);
  await waitFor(wz, `!document.getElementById('s-agree').hidden`, 5000);
  check('未勾同意前「開始安裝」停用', (await js(wz, `document.getElementById('btnInstall').disabled`)) === true);
  await shot(wz, '04-精靈-步驟3-同意前.png');
  await js(wz, `document.getElementById('agreeBox').click()`);
  check('勾選同意後「開始安裝」可按', (await js(wz, `document.getElementById('btnInstall').disabled`)) === false);
  await shot(wz, '05-精靈-步驟3-已同意.png');

  // F. 步驟 4：安裝與註冊
  await js(wz, `document.getElementById('btnInstall').click()`);
  const finished = await waitFor(wz, `!document.getElementById('doneBox').hidden || !document.getElementById('repairBox').hidden`, 180_000);
  await wait(400);
  await shot(wz, '06-精靈-步驟4-安裝完成.png');
  const doneShown = await js(wz, `!document.getElementById('doneBox').hidden`);
  check('安裝流程結束', finished);
  check('註冊成功才顯示完成按鈕', doneShown, await js(wz, `document.getElementById('installLog').textContent`));
  check('模型已拉取到模擬服務', fake.tags.size >= 1, [...fake.tags].join(','));

  // G. 完成後回到主畫面：主視窗狀態更新，精靈關閉
  await js(wz, `document.getElementById('btnDone').click()`);
  await wait(800);
  const wizClosed = !findWizard();
  check('按「完成並返回主畫面」後精靈視窗關閉', wizClosed);
  await js(mainWin, `document.querySelector('.rail-item[data-page="settings"]').click()`);
  await wait(500);
  const summary = await js(mainWin, `document.getElementById('localAiSummary').textContent`);
  check('主畫面摘要已更新為已安裝', /已安裝並啟用/.test(summary), summary);
  await shot(mainWin, '07-主畫面-安裝後摘要.png');

  // H. 失敗與修復：重新開啟精靈，模擬拉取模型失敗
  fake.tags.clear();
  fake.failPulls = 99;
  const wz2 = await openWizard(mainWin);
  await js(wz2, `document.getElementById('btnCheck').click()`);
  await waitFor(wz2, `!document.getElementById('s-choose').hidden`, 90_000);
  await js(wz2, `[...document.querySelectorAll('input[name="aiChoice"]')].find(i => i.value !== 'skip').click()`);
  await js(wz2, `document.getElementById('btnToAgree').click()`);
  await waitFor(wz2, `!document.getElementById('s-agree').hidden`, 5000);
  await js(wz2, `document.getElementById('agreeBox').click()`);
  await js(wz2, `document.getElementById('btnInstall').click()`);
  const repair = await waitFor(wz2, `!document.getElementById('repairBox').hidden`, 240_000);
  await wait(400);
  await shot(wz2, '08-精靈-失敗與修復選項.png');
  check('拉取失敗時顯示修復區', repair);
  check('失敗時確實自動重試（拉取次數 ≥ 2）', fake.pullCalls >= 2, fake.pullCalls);
  check('失敗時不顯示完成按鈕', await js(wz2, `document.getElementById('doneBox').hidden`));
  check('修復按鈕至少 3 個', (await js(wz2, `document.querySelectorAll('#repairActions button').length`)) >= 3);

  // I. 修復：重試（服務恢復）
  fake.failPulls = 0;
  await js(wz2, `[...document.querySelectorAll('#repairActions button')].find(b => /重試/.test(b.textContent)).click()`);
  const recovered = await waitFor(wz2, `!document.getElementById('doneBox').hidden`, 180_000);
  await wait(400);
  await shot(wz2, '09-精靈-修復後完成.png');
  check('按「重試」後註冊成功', recovered);
  await js(wz2, `document.getElementById('btnDone').click()`);
  await wait(800);

  // J. 爬取模組（實際連線司法院一次，唯讀），在獨立精靈內進行
  const wz3 = await openWizard(mainWin);
  await js(wz3, `document.getElementById('crawlerInstall').click()`);
  const crawlDone = await waitFor(wz3, `/已安裝並啟用|安裝失敗/.test(document.getElementById('crawlerStatus').textContent)`, 180_000);
  await wait(400);
  await shot(wz3, '10-精靈-爬取模組.png');
  const crawlStatus = await js(wz3, `document.getElementById('crawlerStatus').textContent`);
  check('爬取模組安裝有明確結果（成功或失敗）', crawlDone, crawlStatus);
  wz3.close();

  await wait(500);
  const summaryAfter = await js(mainWin, `document.getElementById('localAiSummary').textContent`);
  check('爬取模組的結果不改動 AI 引擎摘要（模組獨立）', /已安裝並啟用/.test(summaryAfter), summaryAfter);

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((e) => {
    console.error('煙霧測試例外：', e);
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), error: String(e), results }, null, 2));
    app.exit(2);
  });
});
