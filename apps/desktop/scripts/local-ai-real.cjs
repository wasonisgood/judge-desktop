// 本地模組 3.1 的「真實環境」端到端測試（不模擬引擎與模型）。
// 在這台電腦上真的：下載 Ollama 官方 zip（GitHub 摘要校驗）→ 解壓 → 啟動服務 → 拉取模型 → 對話測試；
// 再注入故障（停止服務、刪除模型、損毀下載、舊版既有服務、壞的模組更新），確認排除問題能找到並修好。
// 執行：npx electron scripts/local-ai-real.cjs   （需先 npm run build；會下載約 2 GB，請保持網路）
// 測試資料夾 JUDGE_REAL_UD（預設 %TEMP%\judge-real-ud）持久保存，重跑時沿用已下載的檔案。
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const outDir = process.env.LOCAL_REAL_DIR || path.join(__dirname, '..', '..', '..', 'docs', 'testing', 'local-ai-real');
fs.mkdirSync(outDir, { recursive: true });
const ud = process.env.JUDGE_REAL_UD || path.join(os.tmpdir(), 'judge-real-ud');
fs.mkdirSync(ud, { recursive: true });
app.setPath('userData', ud);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + String(detail).slice(0, 300) + ']' : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const save = () => fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function waitFor(w, expr, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await w.webContents.executeJavaScript(expr)) return true; } catch { /* 切換中 */ }
    await wait(500);
  }
  return false;
}
async function shot(w, name) {
  await wait(400);
  fs.writeFileSync(path.join(outDir, name), (await w.webContents.capturePage()).toPNG());
}
const findWizard = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('wizard.html'));
const findMain = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'));
const js = (w, code) => w.webContents.executeJavaScript(code);

const OWN = 'http://127.0.0.1:11435';
function ownOllamaPids() {
  try {
    const dir = path.join(ud, 'engine').replace(/'/g, "''");
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process ollama -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${dir}*' } | ForEach-Object { $_.Id }`], { encoding: 'utf8' });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}
function killOwnOllama() {
  for (const pid of ownOllamaPids()) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* 已結束 */ } }
}
async function ownVersion() {
  try { return (await (await fetch(`${OWN}/api/version`, { signal: AbortSignal.timeout(3000) })).json()).version; } catch { return null; }
}
async function listModels(base = OWN) {
  const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  return ((await r.json()).models || []).map((m) => m.name);
}
async function deleteModel(model) {
  await fetch(`${OWN}/api/delete`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) });
}

// 本機檔案伺服器；map 可在啟動後修改（請求時才讀取）。
function serveFiles(map) {
  const server = http.createServer((req, res) => {
    const body = map[req.url.split('?')[0]];
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

async function openWizard(main) {
  await js(main, `document.getElementById('openWizard').click()`);
  for (let i = 0; i < 60; i++) {
    const wz = findWizard();
    if (wz && !wz.webContents.isLoading()) { await wait(500); return wz; }
    await wait(250);
  }
  throw new Error('精靈視窗沒有開啟');
}

/** 在排除問題頁執行檢查，等待「這一次」的結果（先清空，避免讀到舊結果）。 */
async function runDiagnoseUi(wz) {
  await js(wz, `document.querySelector('.wiz-nav[data-view="diag"]').click()`);
  await waitFor(wz, `(() => { const t = document.getElementById('diagSummary').textContent; return t && !/檢查中/.test(t); })()`, 180_000);
  await wait(300);
  return js(wz, `({ summary: document.getElementById('diagSummary').textContent, items: [...document.querySelectorAll('#diagGroups .wiz-row')].map(li => ({ title: li.querySelector('.wiz-row-title').textContent, status: li.querySelector('.wiz-pill').textContent, detail: li.querySelector('.wiz-row-detail').textContent, fix: li.querySelector('.wiz-row-side button') ? li.querySelector('.wiz-row-side button').textContent : null })) })`);
}

/** 點擊排除問題中某一項的修復按鈕（真的 UI 操作），等待修復與重新檢查結束。 */
async function clickFixFor(wz, title) {
  const found = await js(wz, `(() => { const li = [...document.querySelectorAll('#diagGroups .wiz-row')].find(x => x.querySelector('.wiz-row-title').textContent === ${JSON.stringify(title)}); const b = li && li.querySelector('.wiz-row-side button'); if (!b) return false; b.click(); return true; })()`);
  if (!found) return false;
  await wait(300);
  await waitFor(wz, `!/執行修復|檢查中/.test(document.getElementById('diagSummary').textContent)`, 60 * 60_000);
  return true;
}

async function installFromWizard(wz) {
  await js(wz, `document.getElementById('btnCheck').click()`);
  await waitFor(wz, `!document.querySelector('.wiz-view[data-view="choose"]').hidden`, 180_000);
  await js(wz, `(() => { const i = [...document.querySelectorAll('input[name="aiChoice"]')].find(x => x.value === 'recommended') || document.querySelector('input[name="aiChoice"]'); i.click(); })()`);
  await js(wz, `document.getElementById('btnToAgree').click()`);
  await waitFor(wz, `!document.querySelector('.wiz-view[data-view="agree"]').hidden`, 5000);
  await js(wz, `document.getElementById('agreeBox').click()`);
  await js(wz, `document.getElementById('btnInstall').click()`);
  return waitFor(wz, `!document.getElementById('btnToDone').disabled || !document.getElementById('failBox').hidden`, 60 * 60_000);
}

async function main() {
  require('../dist/main/main.js');
  const L = require('../dist/main/localAi.js');
  let mainWin = null;
  for (let i = 0; i < 100 && !mainWin; i++) { mainWin = findMain(); if (!mainWin || mainWin.webContents.isLoading()) { mainWin = null; await wait(150); } }
  if (!mainWin) throw new Error('主視窗沒有載入');
  await wait(1000);

  // ===== A. 真實安裝（從精靈 UI 操作） =====
  killOwnOllama();
  await wait(1500);
  const wz = await openWizard(mainWin);
  await shot(wz, '01-精靈-檢查前.png');
  const finished = await installFromWizard(wz);
  await shot(wz, '02-安裝結束.png');
  const done = await js(wz, `!document.getElementById('btnToDone').disabled`);
  const installLog = await js(wz, `document.getElementById('stageList').textContent`);
  const repairMsg = await js(wz, `document.getElementById('failTech').textContent`);
  check('A1 真實安裝流程結束', finished, installLog.slice(0, 400));
  check('A2 真實安裝完成並註冊', done, repairMsg);
  const ver = await ownVersion();
  check('A3 自己的引擎服務在 11435 回應並有版本', !!ver, ver);
  const models = await listModels();
  check('A4 所需模型已拉取', models.some((m) => m.startsWith('qwen2.5')), models.join(','));
  const chat = await fetch(`${OWN}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: models.find((m) => m.startsWith('qwen2.5')), stream: false, messages: [{ role: 'user', content: '請只回答 OK' }] }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  check('A5 真實模型能生成回答', !!chat?.message?.content, chat?.message?.content || chat?.error);

  const d1 = await runDiagnoseUi(wz);
  await shot(wz, '03-排除問題-正常.png');
  check('A6 排除問題：正常狀態沒有失敗項目', d1.items.length > 0 && d1.items.every((i) => i.status !== '失敗'), JSON.stringify(d1.items.filter((i) => i.status === '失敗')));
  check('A7 排除問題：引擎架構與系統相符（ARM64）', d1.items.some((i) => i.title === '引擎架構' && i.status === '通過'), JSON.stringify(d1.items.find((i) => i.title === '引擎架構')));

  // ===== B. 故障一：服務被停止 =====
  killOwnOllama();
  await wait(2000);
  const d2 = await runDiagnoseUi(wz);
  await shot(wz, '04-排除問題-服務停止.png');
  check('B1 排除問題能偵測服務停止', d2.items.some((i) => i.title === '本地服務運作' && i.status === '失敗'), JSON.stringify(d2.items.find((i) => i.title === '本地服務運作')));
  check('B2 點修復按鈕（重新啟動服務）', await clickFixFor(wz, '本地服務運作'));
  const d3 = await runDiagnoseUi(wz);
  await shot(wz, '05-排除問題-修復後.png');
  check('B3 修復後服務恢復', d3.items.some((i) => i.title === '本地服務運作' && i.status === '通過'), JSON.stringify(d3.items.find((i) => i.title === '本地服務運作')));

  // ===== C. 故障二：模型被刪除 =====
  const victim = models.find((m) => m.startsWith('qwen2.5'));
  await deleteModel(victim);
  const d4 = await runDiagnoseUi(wz);
  await shot(wz, '06-排除問題-模型缺少.png');
  check('C1 排除問題能偵測缺少模型', d4.items.some((i) => i.title === '模型檔案' && i.status === '失敗'), JSON.stringify(d4.items.find((i) => i.title === '模型檔案')));
  check('C2 點修復按鈕（重新下載模型）', await clickFixFor(wz, '模型檔案'));
  const d5 = await runDiagnoseUi(wz);
  await shot(wz, '07-排除問題-模型已重下.png');
  check('C3 修復後模型重新下載完成', d5.items.some((i) => i.title === '模型檔案' && i.status === '通過') && (await listModels()).includes(victim), JSON.stringify(d5.items.find((i) => i.title === '模型檔案')));

  // ===== D. 故障三：引擎下載內容損毀（SHA-256 必須擋下） =====
  const realSha = JSON.parse(fs.readFileSync(path.join(ud, 'engine', 'engine.json'), 'utf8')).zipSha256;
  const bogus = Buffer.from('not a real zip '.repeat(2000));
  const bogusMap = { '/bad.zip': bogus };
  const { server: badSrv, base: badBase } = await serveFiles(bogusMap);
  process.env.JUDGE_OLLAMA_ZIP_URL = `${badBase}/bad.zip`;
  process.env.JUDGE_OLLAMA_ZIP_SHA256 = realSha;
  const plan = JSON.parse(fs.readFileSync(path.join(ud, 'engine', 'plan.json'), 'utf8'));
  const stBad = await L.runRepair('reinstall-engine', () => {});
  delete process.env.JUDGE_OLLAMA_ZIP_URL;
  delete process.env.JUDGE_OLLAMA_ZIP_SHA256;
  badSrv.close();
  check('D1 損毀的引擎下載被 SHA-256 擋下（不換入）', stBad.status === 'failed' && /HASH_MISMATCH|雜湊校驗失敗/.test(stBad.lastError || ''), stBad.lastError);
  const stillUp = await ownVersion();
  check('D2 校驗失敗時既有服務仍可用（未被破壞）', !!stillUp, stillUp);
  // 讓精靈顯示這個失敗狀態
  await js(wz, `document.querySelector('#wizTabs .tab[data-s="diag"]').click()`);
  await shot(wz, '08-引擎校驗失敗-排除問題.png');

  const stRetry = await L.runRepair('retry', () => {});
  check('D3 清除故障後重試可恢復（ready）', stRetry.status === 'ready', stRetry.lastError || stRetry.status);
  await shot(wz, '09-重試後恢復.png');
  void plan;

  // ===== E. 模組獨立更新：正常更新、壞的更新回滾 =====
  const modDir = path.join(ud, 'modules', 'ai-engine', 'current');
  const crawlerEp = fs.readFileSync(path.join(ud, 'modules', 'crawler', 'current', 'endpoints.json'));
  const newRules = JSON.parse(fs.readFileSync(path.join(modDir, 'rules.json'), 'utf8'));
  newRules.rulesVersion = 2;
  newRules.tiers.light.minRamGB = 6;
  const goodRulesBuf = Buffer.from(JSON.stringify(newRules, null, 2) + '\n');
  const catalogOf = (rulesBuf, version, base) => ({
    catalogVersion: 1,
    modules: {
      'ai-engine': { version, requiresAppUpdate: false, files: { 'rules.json': { sha256: sha(rulesBuf), size: rulesBuf.length, url: `${base}/rules.json` } } },
      crawler: { version: '1.0.0', requiresAppUpdate: false, files: { 'endpoints.json': { sha256: sha(crawlerEp), size: crawlerEp.length, url: `${base}/endpoints.json` } } },
    },
  });
  const modMap = { '/rules.json': goodRulesBuf, '/endpoints.json': crawlerEp };
  const { server: modSrv, base: modBase } = await serveFiles(modMap);
  modMap['/modules.json'] = Buffer.from(JSON.stringify(catalogOf(goodRulesBuf, '1.1.0', modBase)));
  process.env.JUDGE_MODULES_CATALOG_URL = `${modBase}/modules.json`;

  const chk = await L.checkModuleUpdates();
  const aiPlan = chk.plans.find((p) => p.moduleId === 'ai-engine');
  check('E1 檢查更新：ai-engine 1.0.0 → 1.1.0', chk.ok && aiPlan && aiPlan.fromVersion === '1.0.0' && aiPlan.toVersion === '1.1.0', JSON.stringify(aiPlan));
  check('E2 只下載變動檔案（rules.json 1 個，端點不下載）', aiPlan && aiPlan.download.length === 1 && aiPlan.download[0] === 'rules.json', JSON.stringify(aiPlan?.download));
  const crawlPlan = chk.plans.find((p) => p.moduleId === 'crawler');
  check('E3 未變動的模組顯示已是最新', crawlPlan && crawlPlan.upToDate, JSON.stringify(crawlPlan));

  // 以 UI 操作：排除問題頁的模組更新區
  await js(wz, `document.querySelector('.wiz-nav[data-view="modules"]').click()`);
  await js(wz, `document.getElementById('btnUpdCheck').click()`);
  await waitFor(wz, `!/檢查中/.test(document.getElementById('updSummary').textContent)`, 60_000);
  const updTxt = await js(wz, `document.getElementById('updRows').textContent`);
  await shot(wz, '10-模組更新-檢查結果.png');
  check('E4 UI 顯示更新計畫（1.0.0 → 1.1.0）', /ai-engine：1\.0\.0 → 1\.1\.0/.test(updTxt), updTxt);
  await js(wz, `document.getElementById('btnUpdApply').click()`);
  await waitFor(wz, `!document.getElementById('btnUpdApply').disabled`, 120_000);
  await wait(800);
  const updDone = await js(wz, `document.getElementById('updRows').textContent + ' ' + document.getElementById('updSummary').textContent`);
  await shot(wz, '11-模組更新-完成.png');
  const rulesNow = JSON.parse(fs.readFileSync(path.join(modDir, 'rules.json'), 'utf8'));
  check('E5 套用後 rules.json 為新版、模組版本 1.1.0', rulesNow.rulesVersion === 2 && /已更新到 1\.1\.0/.test(updDone), updDone);
  check('E6 套用後暫存與備份已清除', !fs.existsSync(`${modDir}.staging`) && !fs.existsSync(`${modDir}.previous`));

  // 壞的更新：目錄宣告的摘要是 goodV3，伺服器卻給損毀內容 → 下載校驗失敗，目前版本不變
  const goodV3 = Buffer.from(JSON.stringify({ ...newRules, rulesVersion: 3 }, null, 2));
  const brokenMap = { '/rules.json': Buffer.from('{"broken":true}'), '/endpoints.json': crawlerEp };
  const { server: brokenSrv, base: brokenBase } = await serveFiles(brokenMap);
  brokenMap['/modules.json'] = Buffer.from(JSON.stringify(catalogOf(goodV3, '1.2.0', brokenBase)));
  process.env.JUDGE_MODULES_CATALOG_URL = `${brokenBase}/modules.json`;
  const badApply = await L.applyModuleUpdates(() => {});
  brokenSrv.close();
  const aiBad = badApply.results.find((r) => r.module === 'ai-engine');
  const rulesAfter = JSON.parse(fs.readFileSync(path.join(modDir, 'rules.json'), 'utf8'));
  check('E7 壞的模組更新被擋下（校驗失敗）', aiBad && !aiBad.ok && /校驗失敗/.test(aiBad.message), aiBad?.message);
  check('E8 失敗後維持 1.1.0（沒有半新半舊）', rulesAfter.rulesVersion === 2 && !fs.existsSync(`${modDir}.staging`), String(rulesAfter.rulesVersion));
  delete process.env.JUDGE_MODULES_CATALOG_URL;
  modSrv.close();

  // ===== F. 既有的舊版 Ollama：不沿用，改用自己的新版 =====
  const oldSrv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.12.0' }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [] }));
    res.writeHead(404); res.end();
  });
  const portFree = await new Promise((resolve) => { oldSrv.once('error', () => resolve(false)); oldSrv.listen(11434, '127.0.0.1', () => resolve(true)); });
  if (portFree) {
    const events = [];
    const p = { tier: 'light', judgmentModel: 'qwen2.5:3b', chatModel: 'qwen2.5:3b', installBoth: false, requiredDiskGB: 3, reasons: [] };
    const st = await L.installAiEngineModule(p, (e) => events.push(e));
    const dec = events.find((e) => e.stage === 'decideEngine' && e.status === 'done');
    check('F1 舊版既有服務（0.12.0）不被沿用', !!dec && /低於需求/.test(dec.detail || ''), dec?.detail);
    check('F2 改用自己的新版引擎並註冊成功', st.status === 'ready', st.lastError || st.status);
    await new Promise((r) => oldSrv.close(r));
  } else {
    check('F 略過：11434 已被其他程式佔用（未動使用者的服務）', true, '未測試舊版情境');
  }

  // ===== G. 爬取模組（實際連線司法院一次） =====
  await js(wz, `document.getElementById('crawlerInstall').click()`);
  await waitFor(wz, `/已啟用|安裝失敗/.test(document.getElementById('modCrPill').textContent)`, 180_000);
  const crawl = await js(wz, `document.getElementById('modCrPill').textContent`);
  await shot(wz, '12-爬取模組.png');
  check('G1 爬取模組安裝完成（實際連線司法院）', /已安裝並啟用/.test(crawl), crawl);

  // ===== H. 主程序的 AI 呼叫走本地引擎 =====
  const be = await L.localBackendIfReady();
  let reply = null;
  if (be) {
    try { reply = await be.run('judgment', { prompt: '請只回答 OK' }); } catch (e) { reply = { error: String(e) }; }
  }
  check('H1 AI 引擎就緒時主程序使用本地後端生成回答', !!reply && typeof reply.text === 'string' && reply.text.length > 0, JSON.stringify(reply).slice(0, 200));
  await shot(mainWin, '13-主畫面.png');

  // ===== I. 匯出診斷報告，並確認不含使用者路徑 =====
  const exported = await L.exportDiagnosticReport();
  const txt = fs.readFileSync(exported, 'utf8');
  check('I1 可匯出診斷報告', fs.existsSync(exported), exported);
  check('I2 診斷報告不含 Windows 路徑', !/[A-Za-z]:\\/.test(txt), '');
  fs.copyFileSync(exported, path.join(outDir, 'diagnostic-report.txt'));

  save();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通過 ${results.length - failed.length}/${results.length}`);
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((e) => {
    console.error('真實測試例外：', e);
    check('測試執行例外', false, String((e && e.stack) || e));
    save();
    app.exit(2);
  });
});
