// IPC：視窗控制與應用程式資訊。視窗控制一律作用在「發出請求的那個視窗」（主視窗或本地模組精靈視窗）。
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { readUpdaterStatus, openUpdater } from '../services/updaterService';

const senderWin = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

export function registerWindowIpc(): void {
  ipcMain.handle('win:minimize', (e) => senderWin(e)?.minimize());
  ipcMain.handle('win:toggleMaximize', (e) => {
    const w = senderWin(e);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
  });
  ipcMain.handle('win:close', (e) => senderWin(e)?.close());
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('app:updaterStatus', () => readUpdaterStatus());
  ipcMain.handle('update:openUpdater', () => openUpdater(true));
}
