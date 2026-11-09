// 畫面冒煙測試（v3.7.0）：工作負載身分聯盟引導面板。
// 執行：npx electron scripts/ui-smoke-federation.cjs   （需先 npm run build；JUDGE_SKIP_AUTH=1）
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const shotDir = process.env.UI_SMOKE_DIR || path.join(process.cwd(), 'ui-smoke-out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

require('../dist/main/main.js');

app.whenReady().then(async () => {
  let w;
  try {
    for (let i = 0; i < 100; i++) {
      w = BrowserWindow.getAllWindows()[0];
      if (w && !w.webContents.isLoading()) break;
      await wait(100);
    }
    await wait(800);
    const js = (c) => w.webContents.executeJavaScript(c);
    fs.mkdirSync(shotDir, { recursive: true });

    await js(`document.querySelector('.rail-item[data-page="settings"]').click()`);
    await wait(300);
    check('預設（API 金鑰）時不顯示聯盟面板', await js(`document.getElementById('fedPanel').hidden === true`));
    check('舊的「進階」聯盟欄位已移除', await js(`!document.getElementById('fedFields')`));

    await js(`(function(){var s=document.getElementById('setAuthMode'); s.value='federation'; s.dispatchEvent(new Event('change'));})()`);
    await wait(400);
    check('切到聯盟後顯示面板', await js(`document.getElementById('fedPanel').hidden === false`));
    check('四個步驟按鈕', await js(`document.querySelectorAll('#fedSteps .fed-step-btn').length === 4`));
    check('第一步內容可見、其餘隱藏', await js(`(function(){var b=document.querySelectorAll('#fedPanel [data-step-body]');return !b[0].hidden && b[1].hidden && b[2].hidden && b[3].hidden;})()`));
    check('發行者 URL 由本工具固定值填入', await js(`document.getElementById('fedIssuer').textContent === 'https://judge-remote-mcp-2026.web.app'`));
    check('API 金鑰欄位在聯盟模式隱藏', await js(`getComputedStyle(document.getElementById('keyField')).display === 'none'`));

    await js(`document.querySelector('#fedSteps [data-step="4"]').click()`);
    await wait(150);
    check('切到第四步', await js(`!document.querySelector('[data-step-body="4"]').hidden`));

    await js(`(function(){var e=document.getElementById('setFedOrg'); e.value='abc'; e.dispatchEvent(new Event('input'));})()`);
    await wait(500);
    check('組織 ID 格式錯誤時即時提示', await js(`document.getElementById('fedMsgOrg').classList.contains('bad')`));
    check('測試連線在設定不完整時停用', await js(`document.getElementById('setTest').disabled === true`));

    await js(`(function(){var set=function(id,v){var e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input'));};
      set('setFedOrg','8c5aaae2-1c0c-4f73-94f8-a8b8d4b6a015'); set('setFedRule','fdrl_01ANPAQtu52UgHvcadQJYGe7'); set('setFedSvc','svac_01CjPwckkun6xbYvckPh2e91');})()`);
    await wait(500);
    check('三組代碼格式正確時，格式提示轉為正確', await js(`document.getElementById('fedMsgRule').classList.contains('good') && document.getElementById('fedMsgSvc').classList.contains('good')`));
    check('已登入前，摘要仍提示尚缺登入', await js(`/尚未登入|尚缺/.test(document.getElementById('fedSummary').textContent)`));

    await js(`(function(){var r=document.getElementById('fedSourceFile'); r.checked=true; r.dispatchEvent(new Event('change'));})()`);
    await wait(300);
    check('選自備檔案時顯示檔案欄位', await js(`document.getElementById('fedFileRow').hidden === false`));
    await js(`(function(){var r=document.getElementById('fedSourceProvider'); r.checked=true; r.dispatchEvent(new Event('change'));})()`);
    await wait(300);
    check('改回本工具簽發後隱藏檔案欄位', await js(`document.getElementById('fedFileRow').hidden === true`));

    check('聯盟規則的主體預設為 desktop:*（全部）', await js(`document.getElementById('fedRuleSub').textContent === 'desktop:*'`));
    await js(`(function(){var r=document.getElementById('fedScopeOne'); r.checked=true; r.dispatchEvent(new Event('change'));})()`);
    await wait(150);
    check('選「只限我自己」時顯示取得主體的按鈕', await js(`document.getElementById('fedSubRow').hidden === false`));

    await w.webContents.capturePage().then((img) => fs.writeFileSync(path.join(shotDir, 'federation-step4.png'), img.toPNG()));
  } catch (err) {
    check('執行過程沒有例外', false, err instanceof Error ? err.stack : String(err));
  } finally {
    const failed = results.filter((r) => !r.ok);
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` — ${r.detail}`}`);
    console.log(`\n${results.length - failed.length}/${results.length} 通過`);
    app.exit(failed.length ? 1 : 0);
  }
});
