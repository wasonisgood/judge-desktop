// 主視窗：無系統選單的自訂視窗。
import { BrowserWindow, Menu, shell } from 'electron';
import * as path from 'node:path';
import { isDev } from '../data/local/paths';
import { getMainWindow, setMainWindow } from './windowState';

/**
 * 應用程式選單：Windows 與 Linux 維持無選單（自訂標題列）。
 * macOS 不同：沒有編輯選單就沒有「複製／貼上／全選」等快捷鍵，因此保留最小的應用程式選單與編輯選單。
 */
function applyAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

export function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    frame: false,
    show: false,
    backgroundColor: '#F1ECE2',
    title: '司法院裁判研究',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setMainWindow(win);
  applyAppMenu();
  win.once('ready-to-show', () => win.show());
  void win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  win.on('closed', () => setMainWindow(null));
}

/** 通知主視窗重新讀取本地模組狀態（若主視窗存在）。 */
export function notifyMainLocalChanged(): void {
  getMainWindow()?.webContents.send('local:changed');
}
