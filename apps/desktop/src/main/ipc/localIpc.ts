// IPC：本地模組（AI 引擎、爬取模組）。方案一律由主程序重新計算，不信任畫面傳來的內容。進度以 local:progress 推送。
import { ipcMain } from 'electron';
import type { RepairActionId } from '@judge/core';
import {
  readModuleStatus, planForUi, installAiEngineModule, installCrawlerModuleForApp,
  runRepair, setSkipAi, type PlanChoice, diagnose, exportDiagnosticReport,
  checkModuleUpdates, applyModuleUpdates, jobStatus,
} from '../localAi';
import { openWizardWindow } from '../windows/wizardWindow';
import { getMainWindow, getWizardWindow } from '../windows/windowState';

export function registerLocalIpc(): void {
  ipcMain.handle('local:modules', () => readModuleStatus());
  ipcMain.handle('local:jobStatus', () => jobStatus());
  ipcMain.handle('local:plan', () => planForUi());
  ipcMain.handle('local:installAi', async (e, args: { choice: PlanChoice }) => {
    const { options } = await planForUi();
    const opt = options.find((o) => o.id === args?.choice);
    if (!opt) throw new Error('找不到所選方案');
    if (opt.id === 'skip') return setSkipAi();
    return installAiEngineModule(opt.plan, (ev) => e.sender.send('local:progress', ev));
  });
  ipcMain.handle('local:installCrawler', (e) => installCrawlerModuleForApp((ev) => e.sender.send('local:progress', ev)));
  ipcMain.handle('local:openWizard', (_e, args?: { view?: 'install' | 'diag' }) => {
    openWizardWindow(args?.view === 'diag' ? 'diag' : 'install');
    return { ok: true };
  });
  ipcMain.handle('local:wizardDone', () => {
    // 註冊完成後才回到主畫面：通知主視窗重新讀取狀態，並關閉精靈視窗。
    getMainWindow()?.webContents.send('local:changed');
    getWizardWindow()?.close();
    return { ok: true };
  });
  // 排除問題與模組更新（3.1）
  ipcMain.handle('local:diagnose', () => diagnose());
  ipcMain.handle('local:exportReport', () => exportDiagnosticReport());
  ipcMain.handle('local:checkUpdates', () => checkModuleUpdates());
  ipcMain.handle('local:applyUpdates', (e) => applyModuleUpdates((ev) => e.sender.send('local:progress', ev)));
  ipcMain.handle('local:repair', (e, args: { action: RepairActionId }) =>
    runRepair(args.action, (ev) => e.sender.send('local:progress', ev)));
}
