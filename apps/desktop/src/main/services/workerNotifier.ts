// 背景工人通知的顯示（v3.9.0）：
// - 自訂樣式：無邊框的小視窗貼在工作區右下角，沿用本站的紙色與墨色樣式（renderer/notify.html）。三個平台共用同一份樣式。
// - 系統樣式：Windows 的 toast、macOS 的通知中心（Electron Notification）。
// 點擊通知會把主視窗叫回前景，並讓畫面切換到對應的頁面（見 worker:open）。
// 通道的選擇策略在 workerNotify.ts（純函式）；這裡只負責實際顯示與點擊後的動作。
import { BrowserWindow, Notification, screen, type WebContents } from 'electron';
import * as path from 'node:path';
import type { Notice } from './workerNotify';
import { safePage } from './workerNotify';
import { getMainWindow } from '../windows/windowState';
import { safeSend } from './safeSend';

const NOTICE_WIDTH = 380;
const NOTICE_HEIGHT = 132;
const NOTICE_GAP = 12;
/** 同時顯示的自訂通知數量上限；超過時關閉最舊的一則。 */
const MAX_VISIBLE = 3;
/** 自訂通知自動關閉的時間（滑鼠停在上面時會暫停）。 */
const AUTO_CLOSE_MS = 12_000;

interface NoticeEntry { win: BrowserWindow; timer: ReturnType<typeof setTimeout> | null }
const notices: NoticeEntry[] = [];
let reopenMainWindow: (() => void) | null = null;

/** 主視窗已被關閉（例如工作完成前隱藏後被收起）時，點通知要能重新建立主視窗；由 main.ts 註冊。 */
export function setReopenMainWindow(fn: () => void): void {
  reopenMainWindow = fn;
}

/** 把主視窗叫回前景並切換到指定頁面；主視窗不存在時先重新建立。 */
export function openMainPage(page: string): void {
  const target = safePage(page);
  let main = getMainWindow();
  if (!main || main.isDestroyed()) {
    reopenMainWindow?.();
    main = getMainWindow();
    if (!main) return;
    main.webContents.once('did-finish-load', () => safeSend(main?.webContents, 'worker:open', { page: target }));
    return;
  }
  if (main.isMinimized()) main.restore();
  if (!main.isVisible()) main.show();
  main.focus();
  if (main.webContents.isLoading()) {
    main.webContents.once('did-finish-load', () => safeSend(main?.webContents, 'worker:open', { page: target }));
  } else {
    safeSend(main.webContents, 'worker:open', { page: target });
  }
}

/** 依通道顯示一則通知。自訂視窗建立失敗時退回系統通知，確保使用者仍會看到。 */
export function deliverNotice(notice: Notice, channel: 'custom' | 'system'): void {
  if (channel === 'custom') {
    try {
      showCustom(notice);
      return;
    } catch (err) {
      console.error('自訂通知視窗建立失敗，改用系統通知：', err);
    }
  }
  showSystem(notice);
}

function showSystem(notice: Notice): void {
  if (!Notification.isSupported()) {
    console.error('此系統不支援通知，略過：', notice.heading);
    return;
  }
  const n = new Notification({ title: `${notice.status}：${notice.heading}`, body: notice.body });
  // 點擊事件：Windows 與 macOS 可靠；Linux 的點擊依桌面環境而異（workerNotify.chooseChannel 已在 Linux 改用自訂視窗）。
  n.on('click', () => openMainPage(notice.page));
  n.show();
}

function showCustom(notice: Notice): void {
  // 超過上限時關閉最舊的一則，再排列剩下的。
  while (notices.length >= MAX_VISIBLE) {
    const oldest = notices.shift();
    if (oldest) closeEntry(oldest);
  }
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: NOTICE_WIDTH,
    height: NOTICE_HEIGHT,
    x: area.x + area.width - NOTICE_WIDTH - NOTICE_GAP,
    y: area.y + area.height - NOTICE_HEIGHT - NOTICE_GAP,
    frame: false,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#F1ECE2',
    title: notice.title,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const entry: NoticeEntry = { win, timer: null };
  notices.push(entry);
  win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => {
    win.showInactive();
    entry.timer = setTimeout(() => closeEntry(entry), AUTO_CLOSE_MS);
  });
  win.on('closed', () => {
    const i = notices.indexOf(entry);
    if (i >= 0) notices.splice(i, 1);
    if (entry.timer) clearTimeout(entry.timer);
    restack();
  });
  void win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'notify.html'), {
    query: { kind: notice.kind, status: notice.status, heading: notice.heading, body: notice.body, page: notice.page },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function closeEntry(entry: NoticeEntry): void {
  if (!entry.win.isDestroyed()) entry.win.close();
}

/** 重新排列剩餘的自訂通知（從右下角往上）。 */
function restack(): void {
  const area = screen.getPrimaryDisplay().workArea;
  notices.forEach((e, i) => {
    if (e.win.isDestroyed()) return;
    const y = area.y + area.height - (NOTICE_HEIGHT + NOTICE_GAP) * (i + 1);
    e.win.setPosition(area.x + area.width - NOTICE_WIDTH - NOTICE_GAP, y, true);
  });
}

/**
 * 自訂通知視窗的動作（只接受來自通知視窗本身的請求）：
 * - click：開啟頁面並關閉通知；dismiss：關閉；hold：滑鼠停留時暫停自動關閉；leave：恢復自動關閉。
 */
export function noticeAction(sender: WebContents, action: 'click' | 'dismiss' | 'hold' | 'leave', page?: string): boolean {
  const entry = notices.find((e) => !e.win.isDestroyed() && e.win.webContents === sender);
  if (!entry) return false;
  if (action === 'hold') {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
  } else if (action === 'leave') {
    if (!entry.timer) entry.timer = setTimeout(() => closeEntry(entry), 4_000);
  } else if (action === 'dismiss') {
    closeEntry(entry);
  } else {
    closeEntry(entry);
    openMainPage(page ?? 'home');
  }
  return true;
}

/** 關閉所有自訂通知（應用程式結束前）。 */
export function closeAllNotices(): void {
  for (const e of [...notices]) closeEntry(e);
}
