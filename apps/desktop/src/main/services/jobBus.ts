// 工作匯流排：本地模組的安裝／修復任務狀態保存在主程序，並把進度廣播給所有視窗。
// 關閉精靈不會中斷安裝；重新開啟時可用 jobStatus() 還原進度。
import { BrowserWindow } from 'electron';
import type { ModuleId, ModuleState } from '@judge/core';
import { AI_ENGINE_MODULE_ID } from '../data/local/localPaths';

export interface StageEvent {
  module: ModuleId;
  stage: string;
  status: 'start' | 'done' | 'failed' | 'progress' | 'retry';
  detail?: string;
  completed?: number;
  total?: number;
}

export type JobKind = 'install' | 'repair' | 'crawler' | null;

const job: { running: boolean; kind: JobKind; events: StageEvent[]; result: ModuleState | null } = { running: false, kind: null, events: [], result: null };

export function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

export function emitStage(ev: StageEvent): void {
  job.events.push(ev);
  if (job.events.length > 300) job.events.shift();
  broadcast('local:progress', ev);
}

export function jobStatus(): { running: boolean; kind: JobKind; events: StageEvent[]; result: ModuleState | null } {
  return { running: job.running, kind: job.kind, events: [...job.events], result: job.result };
}

/** 以任務的方式執行：同時間只有一個任務；已有任務在執行時（例如修復時呼叫安裝）併入同一個任務。 */
export async function runAsJob<T extends ModuleState>(kind: Exclude<JobKind, null>, work: () => Promise<T>): Promise<T> {
  if (job.running) return work();
  job.running = true;
  job.kind = kind;
  job.events = [];
  job.result = null;
  broadcast('local:changed', { id: AI_ENGINE_MODULE_ID, state: null });
  try {
    const st = await work();
    job.result = st;
    return st;
  } finally {
    job.running = false;
    broadcast('local:changed', { id: AI_ENGINE_MODULE_ID, state: null });
  }
}
