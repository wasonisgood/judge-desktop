// 真實環境測試：以真的 UI 操作開啟精靈、執行排除問題、點修復、完成安裝。
const { wait, waitFor, js, findWizard } = require('./realEnv.cjs');

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

module.exports = { openWizard, runDiagnoseUi, clickFixFor, installFromWizard };
