// 本地模組安裝精靈：獨立視窗（與更新程式一樣獨立），不影響主視窗的操作。
import { BrowserWindow } from 'electron';
import * as path from 'node:path';
import { getMainWindow, getWizardWindow, setWizardWindow } from './windowState';
import { notifyMainLocalChanged } from './mainWindow';

export function openWizardWindow(view: 'install' | 'diag' = 'install'): void {
  if (getWizardWindow()) {
    getWizardWindow()?.focus();
    return;
  }
  const wizardWin = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#F1ECE2',
    title: '本地模組',
    parent: getMainWindow() ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setWizardWindow(wizardWin);
  wizardWin.once('ready-to-show', () => wizardWin.show());
  void wizardWin.loadFile(path.join(__dirname, '..', '..', 'renderer', 'wizard.html'), { query: { view } });
  wizardWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  wizardWin.on('closed', () => {
    setWizardWindow(null);
    // 關閉精靈（含中途關閉）後，主視窗也要重新讀取狀態。
    notifyMainLocalChanged();
  });
}
