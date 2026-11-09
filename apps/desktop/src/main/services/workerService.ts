// 背景工人服務（v3.9.0）：使用者不在介面上、或應用程式在背景時，仍依序執行長時間工作。
// - 佇列狀態與轉換在 workerQueue.ts（純函式）；通道與內容在 workerNotify.ts。這裡負責執行、持久化與通知。
// - 實際執行仍透過既有的工作登記（withJob），因此取消、互斥、工作橫幅與既有規則不變。
// - 佇列持久化到 userData/worker-queue.json：程式結束時執行中的工作改為「中斷」，下次開啟時提示可續跑。
// - 目前註冊的種類：scope（範圍整理）。其他種類只要在 HANDLERS 登記即可沿用同一套機制。
import { app, BrowserWindow, Notification } from 'electron';
import * as fs from 'node:fs';
import { userPath } from '../data/local/paths';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { runScope, type ScopeRunArgs } from './scopeService';
import { withJob, cancelJob, type JobKind } from './jobRegistry';
import { broadcast } from './jobBus';
import { toUserError } from './userError';
import {
  type WorkerItem, enqueueItem, startItem, completeItem, failItem, cancelItem, resumeItem, removeItem, setProgress,
  nextQueued, interruptAllRunning, recoverAfterRestart, resumableItems, pruneFinished, serializeQueue, parseQueue,
} from './workerQueue';
import {
  buildNotice, chooseChannel, isNotifiableStatus, shouldNotify, type NoticeStyle,
} from './workerNotify';
import { deliverNotice } from './workerNotifier';

export interface WorkerSettings {
  /** 是否顯示背景工作的通知。 */
  enabled: boolean;
  /** 通知樣式：custom（應用程式內的通知視窗）或 system（系統通知）。 */
  style: NoticeStyle;
}

export const DEFAULT_WORKER_SETTINGS: WorkerSettings = { enabled: true, style: 'custom' };

interface WorkerHandler {
  /** 登記到既有工作登記表時使用的種類（決定橫幅與取消行為）。 */
  jobKind: JobKind;
  /** 點擊通知後開啟的頁面。 */
  page: string;
  /** 檢查參數；回傳錯誤訊息或 null。 */
  validate(payload: unknown): string | null;
  /** 執行工作。被取消時應回傳已完成的部分；worker 會依 signal 判斷為取消。 */
  run(payload: unknown, signal: AbortSignal, progress: (text: string) => void): Promise<{ summary: string; attention?: boolean }>;
}

const scopeHandler: WorkerHandler = {
  jobKind: 'scope',
  page: 'scope',
  validate(payload) {
    const p = payload as Partial<ScopeRunArgs> | null;
    if (!p || typeof p !== 'object') return '缺少範圍整理的參數。';
    if (!Array.isArray(p.statutes) || p.statutes.length === 0 || !p.statutes.every((s) => typeof s === 'string' && s.trim())) {
      return '請至少輸入一個法規名稱。';
    }
    if (typeof p.maxItems !== 'number' || !Number.isFinite(p.maxItems) || p.maxItems < 1) return '每次最多筆數不正確。';
    return null;
  },
  async run(payload, signal, progress) {
    const args = payload as ScopeRunArgs;
    let ai = null;
    if (args.aiAnalysis !== false) {
      try { ai = await requireAi(normalizeAiMode(args.ai), signal); } catch { ai = null; }
    }
    let r;
    try {
      r = await runScope(args, ai, (p) => progress(`${p.statute}：${p.phase} ${p.done}/${p.total}`), signal);
    } catch (err) {
      throw toUserError(err);
    }
    if (r.status === 'ask') {
      return { summary: `「${r.statuteLine}」有多個可能的法規，請回到範圍整理選擇。`, attention: true };
    }
    const rows = r.sheets.reduce((n, s) => n + s.rows.length, 0);
    const saved = r.saveError ? `；存檔失敗：${r.saveError}` : '；已存入檔案管理';
    return { summary: `${r.sheets.length} 個法規、${rows} 筆判決${saved}` };
  },
};

const HANDLERS: Record<string, WorkerHandler> = { scope: scopeHandler };

const QUEUE_FILE = 'worker-queue.json';
const SETTINGS_FILE = 'worker-settings.json';

let items: WorkerItem[] = [];
let settings: WorkerSettings = { ...DEFAULT_WORKER_SETTINGS };
let pumping = false;
/** 由背景工人執行中的工作 id；應用程式的通用工作通知據此避免重複通知。 */
const managed = new Set<string>();

export function isWorkerManagedJob(id: string): boolean {
  return managed.has(id);
}

export function getWorkerSettings(): WorkerSettings {
  return { ...settings };
}

export function listWorkerItems(): WorkerItem[] {
  return items.map((x) => ({ ...x }));
}

/** 讀取持久化的佇列與設定；執行中殘留的工作改為中斷。啟動時呼叫一次。 */
export function loadWorkerState(): void {
  try {
    items = recoverAfterRestart(parseQueue(fs.readFileSync(userPath(QUEUE_FILE), 'utf8')), Date.now());
  } catch {
    items = [];
  }
  try {
    settings = { ...DEFAULT_WORKER_SETTINGS, ...JSON.parse(fs.readFileSync(userPath(SETTINGS_FILE), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_WORKER_SETTINGS };
  }
  persist();
  notifyChanged();
}

/** 寫入磁碟（同步：程式結束前也要能完成）。先寫暫存檔再改名，避免寫到一半損毀。 */
function persist(): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const file = userPath(QUEUE_FILE);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, serializeQueue(items), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('背景工作佇列保存失敗：', err);
  }
}

function notifyChanged(): void {
  broadcast('worker:changed', listWorkerItems());
}

function commit(next: WorkerItem[]): void {
  items = pruneFinished(next);
  persist();
  notifyChanged();
}

function newWorkerId(): string {
  return `wk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 加入佇列並開始處理（若目前沒有執行中的工作）。回傳工作識別碼。 */
export function enqueueWorkerJob(kind: string, label: string, payload: unknown, page?: string): string {
  const handler = HANDLERS[kind];
  if (!handler) throw new Error(`不支援的背景工作：${kind}`);
  const problem = handler.validate(payload);
  if (problem) throw new Error(problem);
  const id = newWorkerId();
  commit(enqueueItem(items, { id, kind, label: label || kind, payload, page: page || handler.page }, Date.now()));
  void pump();
  return id;
}

/** 續跑中斷的工作：回到排隊，依序執行。 */
export function resumeWorkerJob(id: string): void {
  const item = items.find((x) => x.id === id);
  if (item && !HANDLERS[item.kind]) throw new Error(`不支援的背景工作：${item.kind}`);
  commit(resumeItem(items, id));
  void pump();
}

/** 移除工作（執行中不可移除）。 */
export function discardWorkerJob(id: string): void {
  commit(removeItem(items, id));
}

/** 取消工作：執行中的交給工作登記表取消（由執行迴圈轉為已取消）；排隊中的直接取消。 */
export function cancelWorkerJob(id: string): boolean {
  const item = items.find((x) => x.id === id);
  if (!item) return false;
  if (item.status === 'running') return cancelJob(id);
  if (item.status === 'queued') {
    commit(cancelItem(items, id, Date.now()));
    return true;
  }
  return false;
}

/** 程式即將結束：執行中的工作改為中斷並同步寫入磁碟，下次開啟時可續跑。 */
export function interruptWorkerOnQuit(): void {
  if (!items.some((x) => x.status === 'running')) return;
  items = interruptAllRunning(items, Date.now());
  persist();
}

/** 是否有未處理的中斷工作（啟動時提示用）。 */
export function resumableWorkerItems(): WorkerItem[] {
  return resumableItems(items).map((x) => ({ ...x }));
}

export function updateWorkerSettings(patch: Partial<WorkerSettings>): WorkerSettings {
  const next: WorkerSettings = { ...settings };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (patch.style === 'custom' || patch.style === 'system') next.style = patch.style;
  settings = next;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(userPath(SETTINGS_FILE), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('背景工作設定保存失敗：', err);
  }
  return { ...settings };
}

/** 依目前設定與視窗狀態決定是否通知，並選擇通道。 */
function maybeNotify(item: WorkerItem): void {
  if (!isNotifiableStatus(item.status)) return;
  const windowVisible = appWindowVisible();
  if (!shouldNotify({ windowVisible })) return;
  const decision = chooseChannel({
    platform: process.platform,
    enabled: settings.enabled,
    style: settings.style,
    systemSupported: Notification.isSupported(),
  });
  if (decision.channel === 'none') return;
  deliverNotice(buildNotice(item), decision.channel);
}

function appWindowVisible(): boolean {
  // 與 appLifecycle 既有的判斷一致：任一未銷毀的視窗可見即視為使用者正在看畫面。
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  return !!win && win.isVisible();
}

/** 送出一則測試通知（設定頁用）。回傳實際選擇的通道，方便畫面說明。 */
export function sendTestNotice(): { channel: string; reason: string } {
  const decision = chooseChannel({
    platform: process.platform,
    enabled: settings.enabled,
    style: settings.style,
    systemSupported: Notification.isSupported(),
  });
  if (decision.channel !== 'none') {
    deliverNotice(buildNotice({
      label: '背景工作通知測試', page: 'settings', status: 'done', summary: '這是一則測試通知，點擊會開啟設定頁。', error: null, attention: false,
    }), decision.channel);
  }
  return { channel: decision.channel, reason: decision.reason };
}

async function pump(): Promise<void> {
  if (pumping) return;
  const next = nextQueued(items);
  if (!next) return;
  pumping = true;
  const id = next.id;
  const handler = HANDLERS[next.kind];
  managed.add(id);
  commit(startItem(items, id, Date.now()));
  let cancelled = false;
  try {
    if (!handler) throw new Error(`不支援的背景工作：${next.kind}`);
    const result = await withJob(id, handler.jobKind, next.label, async (signal) => {
      const r = await handler.run(next.payload, signal, (text) => {
        try {
          commit(setProgress(items, id, text));
        } catch {
          /* 工作已結束或已取消：進度更新略過 */
        }
      });
      cancelled = signal.aborted;
      return r;
    });
    commit(cancelled
      ? cancelItem(items, id, Date.now())
      : completeItem(items, id, { summary: result.summary, attention: result.attention }, Date.now()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    commit(cancelled ? cancelItem(items, id, Date.now()) : failItem(items, id, message, Date.now()));
  } finally {
    managed.delete(id);
    pumping = false;
  }
  const finished = items.find((x) => x.id === id);
  if (finished) maybeNotify(finished);
  void pump();
}

