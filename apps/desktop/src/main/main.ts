// 主程序：無系統選單的自訂視窗、IPC、設定（金鑰以 safeStorage 加密）、檢索、匯出、本機快取、熱修復與更新程式銜接。
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  searchJudgments, getJudgmentDetail, buildScopeTable, CourtClient,
  analyzeCase, synthesizeScope, briefJudgment,
  type JudgmentDetail, type JudgmentSummary, type ScopeRow, type AiComplete,
  type CaseAnalysis, type ScopeSynthesis, type BriefDocument,
} from '@judge/core';
import { buildListWorkbook, buildBriefDocx } from './exporters';
import { buildScopeWorkbook, buildScopeDocx, type ScopeSheet } from './scopeExporters';
import { callAi, type AiConfig } from './ai';

const isDev = !app.isPackaged;
let win: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
interface StoredSettings {
  aiProvider: 'anthropic' | 'openai-compatible';
  aiBaseUrl: string;
  aiModel: string;
  aiKeyEnc: string | null;
  defaultMaxItems: number;
  cacheDays: number;
}

const DEFAULTS: StoredSettings = {
  aiProvider: 'anthropic',
  aiBaseUrl: 'https://api.anthropic.com',
  aiModel: 'claude-haiku-5-5',
  aiKeyEnc: null,
  defaultMaxItems: 20,
  cacheDays: 7,
};

const userPath = (...p: string[]) => path.join(app.getPath('userData'), ...p);

async function readSettings(): Promise<StoredSettings> {
  try {
    return { ...DEFAULTS, ...JSON.parse(await fs.readFile(userPath('settings.json'), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function writeSettings(s: StoredSettings) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(userPath('settings.json'), JSON.stringify(s, null, 2), 'utf8');
}

function decryptKey(enc: string | null): string | null {
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(enc, 'base64'));
}

function encryptKey(key: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('這台電腦無法加密保存金鑰，請改用其他方式。');
  return safeStorage.encryptString(key).toString('base64');
}

/** 所有 AI 產出都必須經過這裡；沒有金鑰時直接報錯，不會退回規則式的文字切割。 */
async function requireAi(): Promise<AiComplete> {
  const cfg = await aiConfigOrThrow();
  return (system, user, maxTokens) => callAi(cfg, { system, user, maxTokens });
}

async function aiConfigOrThrow(): Promise<AiConfig> {
  const s = await readSettings();
  const key = decryptKey(s.aiKeyEnc);
  if (!key) throw new Error('尚未設定 AI 金鑰，請到「設定」輸入。');
  return { provider: s.aiProvider, baseUrl: s.aiBaseUrl, model: s.aiModel, apiKey: key };
}

// ---------------------------------------------------------------------------
// 本機快取：搜尋結果依設定天數過期；判決內頁不會變動，永久保存
// ---------------------------------------------------------------------------
const cacheDir = () => userPath('cache');

function cacheKey(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function cacheGet<T>(kind: 'search' | 'detail', key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const file = path.join(cacheDir(), kind, cacheKey(key) + '.json');
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs > maxAgeMs) return null;
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function cachePut(kind: 'search' | 'detail', key: string, value: unknown) {
  const dir = path.join(cacheDir(), kind);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, cacheKey(key) + '.json'), JSON.stringify(value), 'utf8');
}

async function cachedSearch(keyword: string, maxItems: number, courtCode?: string): Promise<JudgmentSummary[]> {
  const s = await readSettings();
  const k = JSON.stringify({ keyword, maxItems, courtCode: courtCode ?? '' });
  const hit = await cacheGet<JudgmentSummary[]>('search', k, s.cacheDays * 86_400_000);
  if (hit) return hit;
  const items = await searchJudgments(keyword, { maxItems, courtCode: courtCode || undefined, client: new CourtClient() });
  await cachePut('search', k, items);
  return items;
}

async function cachedDetail(id: string, client?: CourtClient): Promise<JudgmentDetail> {
  const hit = await cacheGet<JudgmentDetail>('detail', id, Number.MAX_SAFE_INTEGER);
  if (hit) return hit;
  const d = await getJudgmentDetail(id, client);
  await cachePut('detail', id, d);
  return d;
}

// ---------------------------------------------------------------------------
// 視窗
// ---------------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    frame: false,
    show: false,
    backgroundColor: '#F1ECE2',
    title: '司法院裁判研究',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win?.show());
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  win.on('closed', () => (win = null));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function registerIpc() {
  ipcMain.handle('win:minimize', () => win?.minimize());
  ipcMain.handle('win:toggleMaximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.handle('win:close', () => win?.close());
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('update:openUpdater', () => openUpdater(true));

  ipcMain.handle('settings:get', async () => {
    const s = await readSettings();
    return {
      aiProvider: s.aiProvider,
      aiBaseUrl: s.aiBaseUrl,
      aiModel: s.aiModel,
      hasKey: !!decryptKey(s.aiKeyEnc),
      defaultMaxItems: s.defaultMaxItems,
      cacheDays: s.cacheDays,
    };
  });
  ipcMain.handle('settings:set', async (_e, patch: Partial<StoredSettings> & { apiKey?: string; clearKey?: boolean }) => {
    const next: StoredSettings = { ...(await readSettings()) };
    for (const k of ['aiProvider', 'aiBaseUrl', 'aiModel', 'defaultMaxItems', 'cacheDays'] as const) {
      if (patch[k] !== undefined) (next as any)[k] = patch[k];
    }
    if (patch.clearKey) next.aiKeyEnc = null;
    if (patch.apiKey) next.aiKeyEnc = encryptKey(patch.apiKey.trim());
    await writeSettings(next);
    return { ok: true };
  });
  ipcMain.handle('cache:clear', async () => {
    await fs.rm(cacheDir(), { recursive: true, force: true });
    return { ok: true };
  });
  ipcMain.handle('ai:test', async () => {
    const cfg = await aiConfigOrThrow();
    const text = await callAi(cfg, { system: '你是測試助手。', user: '只回答：OK', maxTokens: 16 });
    return { ok: true, reply: text.slice(0, 80) };
  });

  // 列表生成
  ipcMain.handle('search:run', async (e, args: { keyword: string; courtCode?: string; maxItems: number; includeFullText: boolean }) => {
    const items = await cachedSearch(args.keyword, args.maxItems, args.courtCode);
    const details: Record<string, Pick<JudgmentDetail, 'meta' | 'sections' | 'fullText'>> = {};
    if (args.includeFullText) {
      let i = 0;
      for (const it of items) {
        i++;
        e.sender.send('search:progress', { done: i, total: items.length, id: it.id });
        const d = await cachedDetail(it.id);
        details[it.id] = { meta: d.meta, sections: d.sections, fullText: d.fullText };
      }
    }
    return { items, details };
  });
  ipcMain.handle('export:list', async (_e, args: { keyword: string; items: JudgmentSummary[]; details: Record<string, any> }) => {
    const save = await dialog.showSaveDialog(win!, {
      title: '儲存判決列表',
      defaultPath: path.join(app.getPath('documents'), `判決列表_${args.keyword}_${stamp()}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    await fs.writeFile(save.filePath, await buildListWorkbook({ keyword: args.keyword, items: args.items, details: args.details }));
    return { canceled: false, filePath: save.filePath };
  });

  // 範圍整理表
  ipcMain.handle('scope:run', async (e, args: { statutes: string[]; yearFrom?: number; yearTo?: number; maxItems: number }) => {
    const ai = await requireAi();
    const sheets: ScopeSheet[] = [];
    const client = new CourtClient();
    for (const statute of args.statutes) {
      const rows: ScopeRow[] = await buildScopeTable({
        statute,
        yearFrom: args.yearFrom,
        yearTo: args.yearTo,
        maxItems: args.maxItems,
        client,
        onProgress: (done, total) => e.sender.send('scope:progress', { statute, done, total, phase: '篩選判決' }),
      });
      const analyses: CaseAnalysis[] = [];
      for (let i = 0; i < rows.length; i++) {
        e.sender.send('scope:progress', { statute, done: i + 1, total: rows.length, phase: 'AI 逐案分析' });
        const d = await cachedDetail(rows[i].id, client);
        analyses.push(await analyzeCase(ai, statute, rows[i], d));
      }
      e.sender.send('scope:progress', { statute, done: 1, total: 1, phase: 'AI 綜合分析' });
      const synthesis: ScopeSynthesis | null = rows.length
        ? await synthesizeScope(ai, statute, analyses)
        : null;
      sheets.push({ statute, rows, analyses, synthesis });
    }
    return { sheets };
  });
  ipcMain.handle('export:scope', async (_e, args: { sheets: ScopeSheet[]; yearFrom?: number; yearTo?: number; format: 'xlsx' | 'docx' }) => {
    const ext = args.format;
    const save = await dialog.showSaveDialog(win!, {
      title: '儲存範圍整理表',
      defaultPath: path.join(app.getPath('documents'), `範圍整理表_${stamp()}.${ext}`),
      filters: [{ name: ext === 'xlsx' ? 'Excel' : 'Word', extensions: [ext] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    const meta = { yearFrom: args.yearFrom, yearTo: args.yearTo };
    const buf = ext === 'xlsx'
      ? await buildScopeWorkbook(args.sheets, meta)
      : await buildScopeDocx(args.sheets, meta);
    await fs.writeFile(save.filePath, buf);
    return { canceled: false, filePath: save.filePath };
  });

  // 單一判決精讀
  ipcMain.handle('brief:run', async (_e, args: { judgmentId: string; focus: string; lengthHint: string }) => {
    const ai = await requireAi();
    const d = await cachedDetail(args.judgmentId);
    const doc: BriefDocument = await briefJudgment(ai, d, { focus: args.focus, length: args.lengthHint });
    return { detail: d, doc };
  });
  ipcMain.handle('export:brief', async (_e, args: { detail: JudgmentDetail; doc: BriefDocument }) => {
    const save = await dialog.showSaveDialog(win!, {
      title: '儲存判決精讀',
      defaultPath: path.join(app.getPath('documents'), `判決精讀_${args.detail.meta.caseNo ?? args.detail.meta.id}.docx`),
      filters: [{ name: 'Word', extensions: ['docx'] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    await fs.writeFile(save.filePath, await buildBriefDocx(args.detail, args.doc));
    return { canceled: false, filePath: save.filePath };
  });
}

// ---------------------------------------------------------------------------
// 更新程式：啟動時在背景執行（安裝資料夾內的 JudgeResearchUpdater.exe）
// ---------------------------------------------------------------------------
function updaterPath(): string {
  return path.join(path.dirname(app.getPath('exe')), 'JudgeResearchUpdater.exe');
}

function openUpdater(manual: boolean): boolean {
  const exe = updaterPath();
  if (isDev || !fsSync.existsSync(exe)) return false;
  const args = ['--app-version', app.getVersion()];
  if (manual) args.push('--manual');
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
  return true;
}

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  registerIpc();
  createWindow();
  if (!isDev) {
    openUpdater(false);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
