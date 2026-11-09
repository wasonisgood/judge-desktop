// 主程序入口：應用程式生命週期與單一實例鎖。其餘邏輯分層於：
//   data/local（設定、快取、檔案管理）、data/cloud（司法院、法規、AI）、services（流程）、ipc（通道註冊）、windows（視窗）。
import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc';
import { createMainWindow } from './windows/mainWindow';
import { getMainWindow } from './windows/windowState';
import { openUpdater } from './services/updaterService';
import { isDev } from './data/local/paths';

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  if (!isDev) {
    openUpdater(false);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
