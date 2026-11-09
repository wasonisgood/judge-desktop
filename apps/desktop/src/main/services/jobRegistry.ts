// 工作登記表（v3.6.0）：所有長時間工作（搜尋、範圍、精讀、助理對話、模組安裝與修復）都在這裡登記。
// 提供：取消（AbortController）、狀態查詢、同類工作互斥、以及「是否還有工作」供關閉流程使用。
// 此模組不依賴 Electron，可直接以 node 測試。
export type JobKind = 'search' | 'scope' | 'brief' | 'assistant' | 'install' | 'repair' | 'criteria';
export type JobStatus = 'running' | 'done' | 'cancelled' | 'failed';

export interface JobInfo {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
}

interface Entry {
  info: JobInfo;
  controller: AbortController;
}

const jobs = new Map<string, Entry>();
/** 互斥的類別：同一類只能有一個執行中的工作（例如模組安裝與修復）。 */
const EXCLUSIVE: ReadonlySet<JobKind> = new Set<JobKind>(['install', 'repair']);

const listeners: { onChange: (list: JobInfo[]) => void; onEnd: (info: JobInfo) => void } = {
  onChange: () => undefined,
  onEnd: () => undefined,
};

export function setJobListeners(onChange: (list: JobInfo[]) => void, onEnd: (info: JobInfo) => void): void {
  listeners.onChange = onChange;
  listeners.onEnd = onEnd;
}

function snapshot(): JobInfo[] {
  return [...jobs.values()].map((e) => ({ ...e.info }));
}

export function listJobs(): JobInfo[] {
  return snapshot();
}

export function runningJobs(): JobInfo[] {
  return snapshot().filter((j) => j.status === 'running');
}

export function runningCount(): number {
  return runningJobs().length;
}

/** 登記一個工作並回傳它的取消訊號。同一 id 已在執行、或互斥類別已有工作時拋出錯誤。 */
export function beginJob(id: string, kind: JobKind, label: string): AbortSignal {
  if (!id) id = newRunId();
  const existing = jobs.get(id);
  if (existing?.info.status === 'running') throw new Error('這項工作已在執行中，請等候完成。');
  if (EXCLUSIVE.has(kind)) {
    const busy = runningJobs().find((j) => EXCLUSIVE.has(j.kind));
    if (busy) throw new Error(`已有「${busy.label}」進行中，請等它完成後再試。`);
  }
  const controller = new AbortController();
  jobs.set(id, { info: { id, kind, label, status: 'running', startedAt: Date.now() }, controller });
  listeners.onChange(snapshot());
  return controller.signal;
}

/** 要求取消。回傳 false 表示找不到執行中的工作。實際結束由工作本身呼叫 finishJob。 */
export function cancelJob(id: string): boolean {
  const e = jobs.get(id);
  if (!e || e.info.status !== 'running') return false;
  e.controller.abort();
  return true;
}

/** 取得執行中、屬於指定類別的工作的取消訊號；沒有則回傳 undefined。 */
export function signalOfRunning(kinds: JobKind[]): AbortSignal | undefined {
  for (const e of jobs.values()) {
    if (e.info.status === 'running' && kinds.includes(e.info.kind)) return e.controller.signal;
  }
  return undefined;
}

/** 產生工作識別碼（畫面未提供時使用）。 */
export function newRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function finishJob(id: string, status: Exclude<JobStatus, 'running'>): void {
  const e = jobs.get(id);
  if (!e) return;
  e.info = { ...e.info, status, endedAt: Date.now() };
  listeners.onChange(snapshot());
  listeners.onEnd({ ...e.info });
  // 已結束的工作保留短時間供查詢，之後清除，避免無限增長。
  setTimeout(() => {
    const cur = jobs.get(id);
    if (cur && cur.info.status !== 'running') jobs.delete(id);
  }, 60_000).unref?.();
}

/** 以登記包住一段工作：正常結束為 done；取消訊號觸發為 cancelled；其餘例外為 failed 並重新拋出。 */
export async function withJob<T>(id: string, kind: JobKind, label: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const runId = id || newRunId();
  const signal = beginJob(runId, kind, label);
  try {
    const result = await work(signal);
    finishJob(runId, signal.aborted ? 'cancelled' : 'done');
    return result;
  } catch (err) {
    finishJob(runId, signal.aborted ? 'cancelled' : 'failed');
    throw err;
  }
}
