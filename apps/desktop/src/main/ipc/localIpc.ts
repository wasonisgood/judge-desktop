// IPC：本地模組（AI 引擎、爬取模組）。方案一律由主程序重新計算，不信任畫面傳來的內容。進度以 local:progress 推送。
import { ipcMain } from 'electron';
import type { RepairActionId } from '@judge/core';
import {
  readModuleStatus, planForUi, installAiEngineModule, installCrawlerModuleForApp,
  runRepair, setSkipAi, type PlanChoice, diagnose, exportDiagnosticReport,
  jobStatus,
} from '../localAi';
import { openWizardWindow } from '../windows/wizardWindow';
import { withJob } from '../services/jobRegistry';
import { safeSend } from '../services/safeSend';
import { toUserError } from '../services/userError';
import { getMainWindow, getWizardWindow } from '../windows/windowState';

export function registerLocalIpc(): void {
  ipcMain.handle('local:modules', () => readModuleStatus());
  ipcMain.handle('local:jobStatus', () => jobStatus());
  ipcMain.handle('local:plan', () => planForUi());
  ipcMain.handle('local:installAi', async (e, args: { runId: string; choice: PlanChoice }) => {
    const { options } = await planForUi();
    const opt = options.find((o) => o.id === args?.choice);
    if (!opt) throw new Error('找不到所選方案');
    if (opt.id === 'skip') return setSkipAi();
    return withJob(args.runId, 'install', '安裝本地 AI', () =>
      installAiEngineModule(opt.plan, (ev) => safeSend(e.sender, 'local:progress', ev))).catch((err) => { throw toUserError(err); });
  });
  ipcMain.handle('local:installCrawler', (e, args: { runId: string }) =>
    withJob(args.runId, 'install', '安裝爬取模組', () =>
      installCrawlerModuleForApp((ev) => safeSend(e.sender, 'local:progress', ev))).catch((err) => { throw toUserError(err); }));
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
  ipcMain.handle('local:repair', (e, args: { runId: string; action: RepairActionId }) =>
    withJob(args.runId, 'repair', '修復本地 AI', () =>
      runRepair(args.action, (ev) => safeSend(e.sender, 'local:progress', ev))).catch((err) => { throw toUserError(err); }));
}
