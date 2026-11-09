// 背景工人通知（v3.9.0，純函式）：通知內容的組裝、跨平台的通道選擇策略、是否需要通知的判斷。
// 實際顯示（Windows／macOS 的系統通知、自訂通知視窗）在 workerNotifier.ts，這裡不依賴 Electron。
import type { WorkerItem } from './workerQueue';

export const APP_TITLE = '司法院裁判研究';
export const NOTICE_BODY_MAX = 140;

/** 通知的種類：決定狀態文字與樣式。 */
export type NoticeKind = 'done' | 'attention' | 'failed' | 'cancelled' | 'interrupted';

export interface Notice {
  kind: NoticeKind;
  /** 狀態文字，例如「已完成」。 */
  status: string;
  /** 工作名稱。 */
  heading: string;
  /** 結果摘要或說明（已截短、已去除換行）。 */
  body: string;
  /** 點擊後開啟的頁面；空字串表示只開啟主視窗。 */
  page: string;
  /** 通知標題（應用程式名稱）。 */
  title: string;
}

export const STATUS_TEXT: Record<NoticeKind, string> = {
  done: '已完成',
  attention: '需要你確認',
  failed: '失敗',
  cancelled: '已取消',
  interrupted: '已中斷',
};

/** 把任意文字壓成單行並截短，避免通知超出版面。 */
export function clip(text: string, max: number = NOTICE_BODY_MAX): string {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** 由工作項目與（可選的）覆寫種類組裝通知內容。 */
export function buildNotice(item: Pick<WorkerItem, 'label' | 'page' | 'status' | 'summary' | 'error' | 'attention'>): Notice {
  let kind: NoticeKind;
  let body: string;
  switch (item.status) {
    case 'done':
      kind = item.attention ? 'attention' : 'done';
      body = item.summary || (item.attention ? '需要你回來確認後才能繼續。' : '工作已完成。');
      break;
    case 'failed':
      kind = 'failed';
      body = item.error || '工作失敗，請重試。';
      break;
    case 'cancelled':
      kind = 'cancelled';
      body = '已取消。';
      break;
    case 'interrupted':
      kind = 'interrupted';
      body = '程式結束前中斷，下次開啟時可續跑。';
      break;
    default:
      // 排隊或執行中不需要通知；回傳一則「已完成」以外的安全預設，呼叫端應先判斷。
      kind = 'done';
      body = '';
  }
  return {
    kind,
    status: STATUS_TEXT[kind],
    heading: clip(item.label, 80),
    body: clip(body),
    page: item.page || '',
    title: APP_TITLE,
  };
}

/** 是否為需要通知的終止狀態（排隊與執行中不通知）。 */
export function isNotifiableStatus(status: WorkerItem['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}

export type NoticeStyle = 'custom' | 'system';
export type NoticeChannel = 'custom' | 'system' | 'none';

export interface ChannelInput {
  /** process.platform */
  platform: string;
  /** 設定中是否開啟背景通知。 */
  enabled: boolean;
  /** 使用者選擇的樣式：自訂（應用程式內的通知視窗）或系統通知。 */
  style: NoticeStyle;
  /** 作業系統通知是否可用（Notification.isSupported()）。 */
  systemSupported: boolean;
}

export interface ChannelDecision {
  channel: NoticeChannel;
  /** 為什麼選這個通道（寫入日誌，方便在各平台回報）。 */
  reason: string;
}

/**
 * 通道選擇策略：
 * - 關閉通知 → none。
 * - 選自訂樣式 → 自訂通知視窗（Electron 的無邊框視窗，三個平台共用同一份樣式）。
 * - 選系統通知：Windows 與 macOS 且系統可用時使用原生通知（Windows 為 toast）；
 *   Linux 的通知點擊事件依桌面環境而異，無法保證能開啟對應頁面，因此改用自訂視窗；
 *   系統通知不可用時也改用自訂視窗，確保使用者仍會看到通知。
 */
export function chooseChannel(input: ChannelInput): ChannelDecision {
  if (!input.enabled) return { channel: 'none', reason: '使用者關閉了背景通知' };
  if (input.style === 'custom') return { channel: 'custom', reason: '使用者選擇自訂樣式' };
  if (input.platform === 'linux') return { channel: 'custom', reason: 'Linux 的通知點擊依桌面環境而異，改用自訂視窗' };
  if (!input.systemSupported) return { channel: 'custom', reason: '系統通知不可用，改用自訂視窗' };
  return { channel: 'system', reason: input.platform === 'win32' ? 'Windows 系統通知（toast）' : 'macOS 系統通知' };
}

/**
 * 是否要通知：主視窗可見時使用者正在看畫面，不另外通知（與既有行為一致）；
 * 視窗隱藏、最小化到背景或已關閉時才通知。
 */
export function shouldNotify(state: { windowVisible: boolean }): boolean {
  return !state.windowVisible;
}

/** 既有工作種類對應的畫面頁面（點擊通知時開啟）。未知種類開啟主視窗的首頁。 */
export function pageForJobKind(kind: string): string {
  switch (kind) {
    case 'search': return 'list';
    case 'scope': return 'scope';
    case 'brief': return 'brief';
    case 'assistant': return 'list';
    case 'install':
    case 'repair': return 'settings';
    default: return 'home';
  }
}

/** 頁面名稱白名單：通知點擊只會開啟這些頁面。 */
export const KNOWN_PAGES: readonly string[] = ['home', 'list', 'scope', 'brief', 'files', 'settings'];

export function safePage(page: string): string {
  return KNOWN_PAGES.includes(page) ? page : 'home';
}
