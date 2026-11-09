// IPC：背景工作（v3.6.0）。畫面可查詢目前的工作、要求取消；工作狀態變化以 jobs:changed 推送。
import { ipcMain } from 'electron';
import { listJobs, cancelJob } from '../services/jobRegistry';

export function registerJobsIpc(): void {
  ipcMain.handle('jobs:list', () => listJobs());
  ipcMain.handle('jobs:cancel', (_e, args: { id: string }) => ({ ok: cancelJob(String(args?.id ?? '')) }));
}
