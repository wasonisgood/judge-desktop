// 應用程式生命週期（v3.6.0）：
// - 關閉主視窗時，若仍有工作在執行：視窗隱藏、工作在背景完成，完成後才真正結束程式，並以系統通知告知。
// - 重新啟動的第二個實例會把隱藏的視窗叫回前景。
// - 啟動時把遺留的「安裝中」狀態（程式先前異常結束）改為失敗，讓使用者可重新安裝。
import { app, BrowserWindow, Notification } from 'electron';
import { broadcast } from './jobBus';
import { setJobListeners, runningCount, type JobInfo } from './jobRegistry';
import { readModuleStatus } from '../data/local/registryStore';
import { setModule } from './moduleState';
import type { ModuleId } from '@judge/core';
import { isWorkerManagedJob, getWorkerSettings } from './workerService';
import { buildNotice, chooseChannel, pageForJobKind, shouldNotify } from './workerNotify';
import { deliverNotice } from './workerNotifier';

let quitAfterJobs = false;

export function initLifecycle(): void {
  setJobListeners(
    (list) => broadcast('jobs:changed', list),
    (info) => {
      if (quitAfterJobs && runningCount() === 0) {
        app.quit();
        return;
      }
      notifyIfHidden(info);
    },
  );
}

/** 工作結束時的通知（v3.9.0 起走背景工人的通道選擇：自訂視窗或系統通知，點擊開啟對應頁面）。 */
function notifyIfHidden(info: JobInfo): void {
  // 背景工人管理的工作由工人自行通知（含結果摘要），這裡不重複通知。
  if (isWorkerManagedJob(info.id)) return;
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!shouldNotify({ windowVisible: !!win && win.isVisible() })) return;
  const settings = getWorkerSettings();
  const decision = chooseChannel({
    platform: process.platform,
    enabled: settings.enabled,
    style: settings.style,
    systemSupported: Notification.isSupported(),
  });
  if (decision.channel === 'none') return;
  deliverNotice(buildNotice({ label: info.label, page: pageForJobKind(info.kind), status: info.status, summary: '', error: null, attention: false }), decision.channel);
}

/** 主視窗要求關閉時呼叫：有工作執行中就隱藏視窗並延後結束，回傳 true 表示已攔下關閉。 */
export function deferCloseIfBusy(win: BrowserWindow): boolean {
  if (runningCount() === 0) return false;
  quitAfterJobs = true;
  win.hide();
  return true;
}

/** 視窗全部關閉時是否應結束程式：有背景工作時不結束。 */
export function shouldQuitOnAllClosed(): boolean {
  return !quitAfterJobs && runningCount() === 0;
}

/** 第二個實例啟動時：把隱藏或最小化的主視窗叫回前景。 */
export function revealMainWindow(win: BrowserWindow | null): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/** 啟動時清理遺留的安裝中狀態：這個程序內沒有對應工作，代表上次安裝因程式結束而中斷。 */
export async function reconcileStaleInstalls(): Promise<void> {
  const states = await readModuleStatus();
  for (const id of Object.keys(states) as ModuleId[]) {
    if (states[id]?.status === 'installing') {
      await setModule(id, {
        status: 'failed',
        lastError: '上次安裝未完成（程式已結束或中斷），請重新安裝。',
        failedStage: states[id]?.failedStage ?? null,
      });
    }
  }
}
