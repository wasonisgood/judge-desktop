// 主視窗：無系統選單的自訂視窗。
import { BrowserWindow, Menu, shell } from 'electron';
import * as path from 'node:path';
import { isDev } from '../data/local/paths';
import { getMainWindow, setMainWindow } from './windowState';

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
  Menu.setApplicationMenu(null);
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
