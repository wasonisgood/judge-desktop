// 匯出自動存檔驗證：不跳對話框，檔案應出現在 文件/司法院裁判研究。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
require('../dist/main/main.js');
app.whenReady().then(async () => {
  let w = null;
  for (let i = 0; i < 100 && !w; i++) { const x = BrowserWindow.getAllWindows()[0]; if (x && !x.webContents.isLoading()) w = x; else await wait(100); }
  await wait(800);
  const r = await w.webContents.executeJavaScript("window.api.exportList({ keyword: '自動存檔測試', items: [{ id: 'x', title: '測試字號', dateIso: '2026-01-01', dateDisplay: '115.01.01', cause: '測試', href: 'https://example.test' }], details: {} })");
  console.log('RESULT', JSON.stringify(r));
  const dir = path.join(app.getPath('documents'), '司法院裁判研究');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.includes('自動存檔測試')) : [];
  console.log('FILES', files.join(' | ') || 'none');
  console.log(files.length && fs.statSync(path.join(dir, files[0])).size > 1000 ? 'AUTOSAVE_OK' : 'AUTOSAVE_FAIL');
  app.exit(0);
});
