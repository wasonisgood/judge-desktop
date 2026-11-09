// IPC：背景工人（v3.9.0）。佇列、續跑與移除、通知設定與測試；通知視窗的點擊與關閉也從這裡進來。
import { ipcMain } from 'electron';
import {
  listWorkerItems, enqueueWorkerJob, resumeWorkerJob, discardWorkerJob, cancelWorkerJob,
  getWorkerSettings, updateWorkerSettings, sendTestNotice,
} from '../services/workerService';
import { noticeAction } from '../services/workerNotifier';

export function registerWorkerIpc(): void {
  ipcMain.handle('worker:list', () => listWorkerItems());
  ipcMain.handle('worker:enqueue', (_e, args: { kind: string; label?: string; payload: unknown; page?: string }) =>
    ({ id: enqueueWorkerJob(String(args?.kind ?? ''), String(args?.label ?? ''), args?.payload, args?.page) }));
  ipcMain.handle('worker:resume', (_e, args: { id: string }) => {
    resumeWorkerJob(String(args?.id ?? ''));
    return { ok: true };
  });
  ipcMain.handle('worker:discard', (_e, args: { id: string }) => {
    discardWorkerJob(String(args?.id ?? ''));
    return { ok: true };
  });
  ipcMain.handle('worker:cancel', (_e, args: { id: string }) => ({ ok: cancelWorkerJob(String(args?.id ?? '')) }));
  ipcMain.handle('worker:settings:get', () => getWorkerSettings());
  ipcMain.handle('worker:settings:set', (_e, patch: { enabled?: boolean; style?: 'custom' | 'system' }) => updateWorkerSettings(patch ?? {}));
  ipcMain.handle('worker:test', () => sendTestNotice());
  // 通知視窗的動作：只接受來自通知視窗本身的請求（noticeAction 會比對發送者）。
  ipcMain.handle('worker:notice:click', (e, args: { page?: string }) => ({ ok: noticeAction(e.sender, 'click', String(args?.page ?? '')) }));
  ipcMain.handle('worker:notice:dismiss', (e) => ({ ok: noticeAction(e.sender, 'dismiss') }));
  ipcMain.handle('worker:notice:hold', (e) => ({ ok: noticeAction(e.sender, 'hold') }));
  ipcMain.handle('worker:notice:leave', (e) => ({ ok: noticeAction(e.sender, 'leave') }));
}
