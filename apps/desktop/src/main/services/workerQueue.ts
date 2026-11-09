// 背景工人佇列（v3.9.0，純函式）：工作排隊、狀態轉換、中斷與續跑、持久化格式。
// 這裡的每個函式都回傳新陣列、不修改輸入；非法的狀態轉換一律拋出 InvalidTransition。
// 不依賴 Electron，可直接以 node 測試。實際執行、登記與通知由 workerService.ts 負責。

export type WorkerStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface WorkerItem {
  id: string;
  /** 工作種類（對應 workerService 的處理函式），例如 scope。 */
  kind: string;
  /** 工作名稱，顯示在橫幅與通知標題。 */
  label: string;
  /** 可 JSON 序列化的工作參數；續跑時以它重新執行。 */
  payload: unknown;
  status: WorkerStatus;
  /** 點擊通知後開啟的頁面（list、scope、brief、files、settings 等）。 */
  page: string;
  /** 完成時的結果摘要（給通知與橫幅使用）。 */
  summary: string;
  /** 執行中的最近進度（例如「3/12 件」）；中斷時保留，續跑提示會顯示。 */
  progress: string;
  /** 失敗或中斷時的說明。 */
  error: string | null;
  /** 完成但需要使用者回來確認（例如法名有多個候選）。 */
  attention: boolean;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface EnqueueInput {
  id: string;
  kind: string;
  label: string;
  payload: unknown;
  page: string;
}

export class InvalidTransition extends Error {
  constructor(id: string, from: WorkerStatus | 'missing', action: string) {
    super(`工作 ${id} 目前為「${from}」，不能${action}。`);
    this.name = 'InvalidTransition';
  }
}

const FINISHED: ReadonlySet<WorkerStatus> = new Set<WorkerStatus>(['done', 'failed', 'cancelled']);
const STATUSES: ReadonlySet<string> = new Set<WorkerStatus>(['queued', 'running', 'done', 'failed', 'cancelled', 'interrupted']);
/** 保留在佇列中的已結束工作上限；超過時移除最舊的已結束項目。 */
export const MAX_FINISHED = 50;

function replaceItem(items: WorkerItem[], id: string, next: WorkerItem): WorkerItem[] {
  return items.map((it) => (it.id === id ? next : it));
}

function find(items: WorkerItem[], id: string): WorkerItem {
  const it = items.find((x) => x.id === id);
  if (!it) throw new InvalidTransition(id, 'missing', '操作');
  return it;
}

export function isFinished(status: WorkerStatus): boolean {
  return FINISHED.has(status);
}

/** 加入一項排隊中的工作。識別碼重複時拋錯。 */
export function enqueueItem(items: WorkerItem[], input: EnqueueInput, now: number): WorkerItem[] {
  if (!input.id) throw new Error('工作識別碼不可為空。');
  if (items.some((x) => x.id === input.id)) throw new Error(`工作 ${input.id} 已存在。`);
  const item: WorkerItem = {
    id: input.id,
    kind: input.kind,
    label: input.label,
    payload: input.payload,
    status: 'queued',
    page: input.page,
    summary: '',
    progress: '',
    error: null,
    attention: false,
    createdAt: now,
    startedAt: null,
    endedAt: null,
  };
  return [...items, item];
}

/** 排隊 → 執行中。 */
export function startItem(items: WorkerItem[], id: string, now: number): WorkerItem[] {
  const it = find(items, id);
  if (it.status !== 'queued') throw new InvalidTransition(id, it.status, '開始執行');
  return replaceItem(items, id, { ...it, status: 'running', startedAt: now, error: null });
}

/** 執行中更新進度文字（只在執行中有效）。 */
export function setProgress(items: WorkerItem[], id: string, text: string): WorkerItem[] {
  const it = find(items, id);
  if (it.status !== 'running') throw new InvalidTransition(id, it.status, '更新進度');
  return replaceItem(items, id, { ...it, progress: text });
}

/** 執行中 → 完成。 */
export function completeItem(items: WorkerItem[], id: string, result: { summary: string; attention?: boolean }, now: number): WorkerItem[] {
  const it = find(items, id);
  if (it.status !== 'running') throw new InvalidTransition(id, it.status, '標記完成');
  return replaceItem(items, id, { ...it, status: 'done', summary: result.summary, attention: result.attention === true, endedAt: now });
}

/** 執行中 → 失敗。 */
export function failItem(items: WorkerItem[], id: string, error: string, now: number): WorkerItem[] {
  const it = find(items, id);
  if (it.status !== 'running') throw new InvalidTransition(id, it.status, '標記失敗');
  return replaceItem(items, id, { ...it, status: 'failed', error, endedAt: now });
}

/** 排隊中或執行中 → 已取消。 */
export function cancelItem(items: WorkerItem[], id: string, now: number): WorkerItem[] {
  const it = find(items, id);
  if (it.status !== 'queued' && it.status !== 'running') throw new InvalidTransition(id, it.status, '取消');
  return replaceItem(items, id, { ...it, status: 'cancelled', endedAt: now });
}

/** 執行中 → 中斷（程式結束時）。保留已完成的進度（payload 不變），下次可續跑。 */
export function interruptItem(items: WorkerItem[], id: string, now: number): WorkerItem[] {
  const it = find(items, id);
  if (it.status !== 'running') throw new InvalidTransition(id, it.status, '標記中斷');
  return replaceItem(items, id, { ...it, status: 'interrupted', error: '程式結束前中斷，可於下次開啟時續跑。', endedAt: now });
}

/** 中斷 → 排隊（使用者按下續跑）。 */
export function resumeItem(items: WorkerItem[], id: string): WorkerItem[] {
  const it = find(items, id);
  if (it.status !== 'interrupted') throw new InvalidTransition(id, it.status, '續跑');
  return replaceItem(items, id, { ...it, status: 'queued', error: null, endedAt: null, startedAt: null });
}

/** 移除工作（執行中不可移除；排隊中要先取消）。 */
export function removeItem(items: WorkerItem[], id: string): WorkerItem[] {
  const it = find(items, id);
  if (it.status === 'running') throw new InvalidTransition(id, it.status, '移除');
  return items.filter((x) => x.id !== id);
}

/** 下一項要執行的工作：一次只執行一項；已有執行中的工作時回傳 undefined。 */
export function nextQueued(items: WorkerItem[]): WorkerItem | undefined {
  if (items.some((x) => x.status === 'running')) return undefined;
  return items.find((x) => x.status === 'queued');
}

/** 程式結束前呼叫：所有執行中的工作改為中斷。 */
export function interruptAllRunning(items: WorkerItem[], now: number): WorkerItem[] {
  return items.map((it) => (it.status === 'running'
    ? { ...it, status: 'interrupted' as const, error: '程式結束前中斷，可於下次開啟時續跑。', endedAt: now }
    : it));
}

/** 程式啟動時呼叫：磁碟上殘留的「執行中」代表上次異常結束，視為中斷。 */
export function recoverAfterRestart(items: WorkerItem[], now: number): WorkerItem[] {
  return interruptAllRunning(items, now);
}

/** 可續跑的工作（中斷且尚未被續跑或移除）。 */
export function resumableItems(items: WorkerItem[]): WorkerItem[] {
  return items.filter((x) => x.status === 'interrupted');
}

/** 超過上限時移除最舊的已結束工作，避免清單無限增長。 */
export function pruneFinished(items: WorkerItem[], keep: number = MAX_FINISHED): WorkerItem[] {
  const finished = items.filter((x) => isFinished(x.status));
  if (finished.length <= keep) return items;
  const sorted = [...finished].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const drop = new Set(sorted.slice(keep).map((x) => x.id));
  return items.filter((x) => !drop.has(x.id));
}

/** 序列化為持久化字串（版本 1）。 */
export function serializeQueue(items: WorkerItem[]): string {
  return JSON.stringify({ version: 1, items }, null, 2);
}

/**
 * 讀取持久化字串。格式錯誤或單一項目不合法時，該項目會被略過而不是讓整個佇列消失；
 * 讀出後的「執行中」一律視為中斷（見 recoverAfterRestart，由呼叫端決定時間點）。
 */
export function parseQueue(text: string): WorkerItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items))
    ? (raw as { items: unknown[] }).items
    : [];
  const out: WorkerItem[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
    if (typeof o.kind !== 'string' || typeof o.label !== 'string' || typeof o.status !== 'string') continue;
    if (!STATUSES.has(o.status)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      kind: o.kind,
      label: o.label,
      payload: o.payload ?? null,
      status: o.status as WorkerStatus,
      page: typeof o.page === 'string' ? o.page : '',
      summary: typeof o.summary === 'string' ? o.summary : '',
      progress: typeof o.progress === 'string' ? o.progress : '',
      error: typeof o.error === 'string' ? o.error : null,
      attention: o.attention === true,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
      startedAt: typeof o.startedAt === 'number' ? o.startedAt : null,
      endedAt: typeof o.endedAt === 'number' ? o.endedAt : null,
    });
  }
  return out;
}
