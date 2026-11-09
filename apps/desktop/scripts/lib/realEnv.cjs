// 真實環境測試的共用工具：等待、在視窗中執行程式、找到主視窗與精靈視窗。
const { BrowserWindow } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(w, expr, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await w.webContents.executeJavaScript(expr)) return true; } catch { /* 切換中 */ }
    await wait(500);
  }
  return false;
}

const findWizard = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('wizard.html'));
const findMain = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'));
const js = (w, code) => w.webContents.executeJavaScript(code);

module.exports = { wait, waitFor, js, findWizard, findMain };
