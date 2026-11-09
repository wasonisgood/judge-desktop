// 主程序入口：應用程式生命週期與單一實例鎖。其餘邏輯分層於：
//   data/local（設定、快取、檔案管理）、data/cloud（司法院、法規、AI）、services（流程）、ipc（通道註冊）、windows（視窗）。
import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc';
import { createMainWindow } from './windows/mainWindow';
import { getMainWindow } from './windows/windowState';
import { openUpdater } from './services/updaterService';
import { isDev } from './data/local/paths';
import { syncBundledModules } from './services/moduleState';
import { installKnowledgeModule } from './services/knowledgeService';
import { initLifecycle, reconcileStaleInstalls, shouldQuitOnAllClosed, revealMainWindow } from './services/appLifecycle';

app.whenReady().then(() => {
  registerIpc();
  initLifecycle();
  reconcileStaleInstalls().catch((err) => console.error('清理安裝狀態失敗：', err));
  // 模組隨應用程式版本同步：啟動時只複製有變動的內建檔案。
  syncBundledModules().catch((err) => console.error('模組同步失敗：', err));
  // 爭點知識庫：啟動時在背景檢查並安裝最新版本（版本相同則略過；失敗只記錄，不影響搜尋與判決功能）。
  installKnowledgeModule().then((r) => { if (!r.ok) console.error('爭點知識庫安裝失敗：', r.error); }).catch((err) => console.error('爭點知識庫安裝失敗：', err));
  createMainWindow();
  if (!isDev) {
    openUpdater(false);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // 有背景工作執行中時不結束程式；工作完成後由生命週期模組結束。
  if (process.platform !== 'darwin' && shouldQuitOnAllClosed()) app.quit();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    revealMainWindow(getMainWindow());
  });
}
