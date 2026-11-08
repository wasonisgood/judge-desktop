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
  LawClient, createCurlFetch, parseSingleCitation, parseCitations, judgmentQueries,
  FederatedTokenProvider, type FederationConfig, resolveLawName, DEFAULT_BRIEF_FIELDS, normalizeBriefFields, type BriefField,
  screenRelevance, type RelevanceItem, openPdf, pagesNeedingOcr, renderPageWithHighlights,
  type JudgmentDetail, type JudgmentSummary, type ScopeRow, type AiComplete,
  type CaseAnalysis, type ScopeSynthesis, type BriefDocument, type CitationRef,
  type HistoryArticle, type CurrentLaw,
} from '@judge/core';
import { buildListWorkbook, buildBriefDocx } from './exporters';
import { buildFourPerPageDocx, groupPages, type PageImage } from './pdfWord';
import { buildScopeWorkbook, buildScopeDocx, type ScopeSheet } from './scopeExporters';
import { callAi, type AiConfig } from './ai';
import { runAssistantTurn, mergeSearchHits, type ToolCall, type ToolOutcome, type AssistantTurn, type SearchHit } from './assistant';
import { LibraryStore, newId, type LibraryStatus } from './library';

const isDev = !app.isPackaged;
let win: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
export interface FederationSettings {
  organizationId: string;
  federationRuleId: string;
  serviceAccountId: string;
  workspaceId: string;
  /** 使用者提供的身分憑證（OIDC JWT）檔案路徑；每次換取時重新讀取。 */
  identityTokenFile: string;
}

interface StoredSettings {
  aiProvider: 'anthropic' | 'openai-compatible';
  aiAuthMode: 'apiKey' | 'federation';
  aiBaseUrl: string;
  aiModel: string;
  aiKeyEnc: string | null;
  federation: FederationSettings;
  defaultMaxItems: number;
  cacheDays: number;
  /** 精讀欄位設定：enabled 表示是否勾選；自訂欄位也保存在這裡。 */
  briefFields: (BriefField & { enabled: boolean })[];
}

const EMPTY_FEDERATION: FederationSettings = {
  organizationId: '', federationRuleId: '', serviceAccountId: '', workspaceId: '', identityTokenFile: '',
};

const DEFAULTS: StoredSettings = {
  aiProvider: 'anthropic',
  aiAuthMode: 'apiKey',
  federation: { ...EMPTY_FEDERATION },
  aiBaseUrl: 'https://api.anthropic.com',
  aiModel: 'claude-haiku-5-5',
  aiKeyEnc: null,
  defaultMaxItems: 20,
  cacheDays: 7,
  briefFields: DEFAULT_BRIEF_FIELDS.map((f) => ({ ...f, enabled: true })),
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

const federationProviders = new Map<string, FederatedTokenProvider>();

async function aiConfigOrThrow(): Promise<AiConfig> {
  const s = await readSettings();
  if (s.aiAuthMode === 'federation') {
    const f = s.federation;
    if (s.aiProvider !== 'anthropic') throw new Error('工作負載身分聯合目前只支援 Anthropic 服務，請到「設定」改用 API 金鑰。');
    if (!f.organizationId || !f.federationRuleId || !f.serviceAccountId || !f.identityTokenFile) {
      throw new Error('尚未完成工作負載身分聯合設定（組織 ID、聯合規則 ID、服務帳號 ID、身分憑證檔）。');
    }
    const cacheKey = JSON.stringify([s.aiBaseUrl, f]);
    let provider = federationProviders.get(cacheKey);
    if (!provider) {
      const cfg: FederationConfig = {
        baseUrl: s.aiBaseUrl,
        organizationId: f.organizationId,
        federationRuleId: f.federationRuleId,
        serviceAccountId: f.serviceAccountId,
        workspaceId: f.workspaceId || undefined,
      };
      provider = new FederatedTokenProvider(cfg, async () => (await fs.readFile(f.identityTokenFile, 'utf8')).trim());
      federationProviders.set(cacheKey, provider);
    }
    const token = await provider.get();
    return { provider: 'anthropic', baseUrl: s.aiBaseUrl, model: s.aiModel, apiKey: token, authMode: 'bearer' };
  }
  const key = decryptKey(s.aiKeyEnc);
  if (!key) throw new Error('尚未設定 AI 金鑰，請到「設定」輸入。');
  return { provider: s.aiProvider, baseUrl: s.aiBaseUrl, model: s.aiModel, apiKey: key, authMode: 'apiKey' };
}

// ---------------------------------------------------------------------------
// 本機快取：搜尋結果依設定天數過期；判決內頁不會變動，永久保存
// ---------------------------------------------------------------------------
const cacheDir = () => userPath('cache');

function cacheKey(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function cacheGet<T>(kind: string, key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const file = path.join(cacheDir(), kind, cacheKey(key) + '.json');
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs > maxAgeMs) return null;
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function cachePut(kind: string, key: string, value: unknown) {
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
// 法規資料：法名確認（永久）、法條沿革（永久）、現行法規全文（30 天）
// 法規來源以系統 curl 連線（立法院站不支援 Node 預設的 TLS 設定），仍保持憑證驗證。
// ---------------------------------------------------------------------------
let libraryInstance: LibraryStore | null = null;
function library(): LibraryStore {
  if (!libraryInstance) libraryInstance = new LibraryStore(userPath('library.json'));
  return libraryInstance;
}

const LAW_CURRENT_TTL_MS = 30 * 86_400_000;
const FOREVER = Number.MAX_SAFE_INTEGER;

function lawClient(): LawClient {
  return new LawClient({ fetchImpl: createCurlFetch() });
}

/** 把使用者輸入的法名確認為全國法規資料庫的正式法名。完全相同或明顯相近時自動採用（會回報），否則列出候選讓使用者選。 */
async function resolveStatute(name: string): Promise<{ name: string; pcode: string; note?: string }> {
  const key = name.trim();
  const hit = await cacheGet<{ name: string; pcode: string; note?: string }>('law-name', key, FOREVER);
  if (hit) return hit;
  const r = await resolveLawName(lawClient(), key);
  if (r.status === 'exact') {
    const out = { name: r.match.name, pcode: r.match.pcode };
    await cachePut('law-name', key, out);
    return out;
  }
  if (r.status === 'auto') {
    const out = { name: r.match.name, pcode: r.match.pcode, note: `「${key}」不是完整的正式法名，已採用最接近的「${r.match.name}」。` };
    await cachePut('law-name', key, out);
    return out;
  }
  if (r.status === 'candidates') {
    const hint = r.candidates.map((x) => x.name).join('、');
    throw new Error(`法規名稱「${key}」找不到完全相同的法規，請選擇：${hint}`);
  }
  throw new Error(`法規名稱「${key}」在全國法規資料庫中查無結果。請確認法名，例如「國家賠償法」。`);
}

async function lawHistoryFor(lawName: string): Promise<HistoryArticle[]> {
  const hit = await cacheGet<HistoryArticle[]>('law-history', lawName, FOREVER);
  if (hit) return hit;
  const { history } = await lawClient().fetchLawHistory(lawName);
  await cachePut('law-history', lawName, history);
  return history;
}

async function currentLawFor(pcode: string): Promise<CurrentLaw> {
  const hit = await cacheGet<CurrentLaw>('law-current', pcode, LAW_CURRENT_TTL_MS);
  if (hit) return hit;
  const law = await lawClient().fetchCurrentLaw(pcode);
  await cachePut('law-current', pcode, law);
  return law;
}

/** 使用者輸入的一行：法名，或「法名＋條項款」（例如「民法第184條第1項第2款」）。 */
export function splitStatuteLine(line: string): { name: string; citation: CitationRef | null } {
  const t = line.trim();
  const cut = t.search(/第\s*[0-9０-９一二三四五六七八九十百千零〇兩]/);
  const name = (cut >= 0 ? t.slice(0, cut) : t).trim();
  return { name, citation: cut >= 0 ? parseSingleCitation(t.slice(cut)) : null };
}

/** 判決是否引用了指定的條（若有指定項、款，也要一併符合）。 */
export function rowCites(row: ScopeRow, cit: CitationRef): boolean {
  return parseCitations(row.citedArticles.join('；')).some((c) =>
    c.article === cit.article &&
    (cit.paragraph === undefined || c.paragraph === cit.paragraph) &&
    (cit.item === undefined || c.item === cit.item));
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

async function executeAssistantTool(call: ToolCall): Promise<ToolOutcome> {
  const input = call.input as Record<string, any>;
  try {
    switch (call.name) {
      case 'search_judgments': {
        const list: string[] = Array.isArray(input.queries) ? input.queries.map(String) : [];
        if (input.query) list.push(String(input.query));
        const queries = [...new Set(list.map((q) => q.trim()).filter(Boolean))].slice(0, 4);
        if (queries.length === 0) return { content: '沒有提供關鍵字。' };
        const groups: SearchHit[][] = [];
        for (const q of queries) {
          const items = await cachedSearch(q, 10);
          groups.push(items.map((it) => ({ id: it.id, title: it.title, date: it.dateIso ?? null, cause: it.cause ?? '' })));
        }
        const merged = mergeSearchHits(groups, 20);
        return { content: merged.length ? JSON.stringify({ queries, hits: merged }) : '查無符合的判決。' };
      }
      case 'resolve_statute': {
        const r = await resolveStatute(String(input.name ?? ''));
        return { content: `正式法名：${r.name}` };
      }
      case 'read_judgment': {
        const d = await cachedDetail(String(input.id ?? ''));
        const main = (d.sections['主文'] ?? '').slice(0, 800);
        const reasoningStart = d.fullText.search(/理\s*由/);
        const reasoning = (reasoningStart >= 0 ? d.fullText.slice(reasoningStart) : d.fullText).slice(0, 6000);
        return { content: JSON.stringify({ title: d.meta.title, court: d.meta.court, date: d.meta.dateIso, cause: d.meta.cause, main, reasoning, fullTextChars: d.fullText.length }) };
      }
      case 'open_page': {
        const page = String(input.page ?? 'home') as AssistantPageName;
        return { content: `已切換到 ${page}。`, navigate: page };
      }
      case 'propose_scope': {
        const statutes = Array.isArray(input.statutes) ? input.statutes.map(String) : [];
        if (statutes.length === 0) return { content: '沒有提供法規名稱。' };
        return {
          content: '已提議，等待使用者按同意後執行。',
          pending: {
            id: newId(),
            kind: 'run_scope',
            label: `範圍整理：${statutes.join('、')}`,
            args: { statutes, yearFrom: input.yearFrom, yearTo: input.yearTo },
          },
        };
      }
      case 'propose_brief': {
        const id = String(input.id ?? '');
        if (!id) return { content: '沒有提供判決 id。' };
        return {
          content: '已提議，等待使用者按同意後執行。',
          pending: { id: newId(), kind: 'run_brief', label: `精讀判決：${id}`, args: { judgmentId: id, focus: String(input.focus ?? '') } },
        };
      }
      default:
        return { content: `不支援的工具：${call.name}` };
    }
  } catch (err) {
    return { content: `執行失敗：${err instanceof Error ? err.message : String(err)}` };
  }
}

type AssistantPageName = 'home' | 'list' | 'scope' | 'brief' | 'files' | 'settings';

/** 匯出一律自動存到「文件／司法院裁判研究」資料夾，跑完後自動開啟，不再跳出存檔對話框。 */
async function autoSaveExport(name: string, data: Buffer): Promise<{ canceled: false; filePath: string }> {
  const dir = path.join(app.getPath('documents'), '司法院裁判研究');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name.replace(/[\/:*?"<>|]/g, '_'));
  await fs.writeFile(file, data);
  void shell.openPath(file);
  return { canceled: false, filePath: file };
}

/**
 * 原版 PDF 標示：下載判決的原版 PDF，把精讀引用的原文以螢光色標示，
 * 每 4 頁存成一份 Word（2×2 格）。沒有文字層的頁面會回報，不猜位置。
 */
async function annotateOriginalPdf(d: JudgmentDetail, doc: BriefDocument): Promise<{ files: string[]; pages: number; highlighted: number; ocrPages: number[]; quotes: number; error?: string }> {
  if (!d.pdfUrl) return { files: [], pages: 0, highlighted: 0, ocrPages: [], quotes: 0, error: '此判決沒有原版 PDF 連結' };
  const bytes = await new CourtClient().requestBytes(d.pdfUrl, { headers: { referer: d.meta.sourceUrl } });
  const pdf = await openPdf(bytes);
  const quotes = [...new Set(doc.sections.flatMap((sec) => sec.evidence ?? []))];
  const ocrPages = await pagesNeedingOcr(pdf);
  const pages: PageImage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const r = await renderPageWithHighlights(pdf, n, quotes, 2.4);
    pages.push({ pageNo: n, png: r.png, widthPx: r.widthPx, heightPx: r.heightPx, highlighted: r.highlighted });
  }
  const label = (d.meta.caseNo ?? d.meta.id).replace(/[\/:*?"<>|]/g, '_');
  const dir = path.join(app.getPath('documents'), '司法院裁判研究', '原版標示');
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  const summary = { title: doc.title, sections: doc.sections.map((sec) => ({ heading: sec.heading, paragraphs: sec.paragraphs })) };
  for (const [idx, group] of groupPages(pages, 4).entries()) {
    const from = group[0].pageNo, to = group[group.length - 1].pageNo;
    const file = path.join(dir, `原版標示_${label}_第${from}-${to}頁.docx`);
    await fs.writeFile(file, await buildFourPerPageDocx(group, `${d.meta.title || label}（第 ${from}–${to} 頁）`, idx === 0 ? summary : undefined));
    files.push(file);
  }
  if (files[0]) void shell.openPath(files[0]);
  return { files, pages: pages.length, highlighted: pages.reduce((n, p) => n + p.highlighted, 0), ocrPages, quotes: quotes.length };
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
      aiAuthMode: s.aiAuthMode,
      federation: s.federation,
      aiBaseUrl: s.aiBaseUrl,
      aiModel: s.aiModel,
      hasKey: !!decryptKey(s.aiKeyEnc),
      defaultMaxItems: s.defaultMaxItems,
      cacheDays: s.cacheDays,
      briefFields: s.briefFields,
    };
  });
  ipcMain.handle('settings:set', async (_e, patch: Partial<StoredSettings> & { apiKey?: string; clearKey?: boolean }) => {
    const next: StoredSettings = { ...(await readSettings()) };
    for (const k of ['aiProvider', 'aiAuthMode', 'aiBaseUrl', 'aiModel', 'defaultMaxItems', 'cacheDays'] as const) {
      if (patch[k] !== undefined) (next as any)[k] = patch[k];
    }
    if (patch.briefFields) {
      next.briefFields = (patch.briefFields as StoredSettings['briefFields']).filter((f) => f && typeof f.name === 'string');
    }
    if (patch.federation) {
      next.federation = { ...EMPTY_FEDERATION, ...next.federation, ...patch.federation };
    }
    if (next.aiAuthMode === 'federation') next.aiProvider = 'anthropic';
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
  ipcMain.handle('search:screen', async (_e, args: { topic: string; items: RelevanceItem[] }) => {
    const ai = await requireAi();
    return screenRelevance(ai, args.topic, args.items.slice(0, 40));
  });
  ipcMain.handle('search:run', async (e, args: { keyword: string; courtCode?: string; maxItems: number; includeFullText: boolean }) => {
    const items = await cachedSearch(args.keyword, args.maxItems, args.courtCode);
    const details: Record<string, Pick<JudgmentDetail, 'meta' | 'sections' | 'fullText'> & { historyPosition: string }> = {};
    if (args.includeFullText) {
      let i = 0;
      for (const it of items) {
        i++;
        e.sender.send('search:progress', { done: i, total: items.length, id: it.id });
        const d = await cachedDetail(it.id);
        details[it.id] = { meta: d.meta, sections: d.sections, fullText: d.fullText, historyPosition: d.historyPosition?.summary ?? '' };
      }
    }
    await library().add({
      kind: 'list',
      title: `判決列表：${args.keyword}`,
      summary: `${items.length} 筆${args.includeFullText ? '（含全文）' : ''}`,
      payload: { keyword: args.keyword, items, details },
    });
    return { items, details };
  });
  ipcMain.handle('export:list', async (_e, args: { keyword: string; items: JudgmentSummary[]; details: Record<string, any> }) => {
    return autoSaveExport(`判決列表_${args.keyword}_${stamp()}.xlsx`, await buildListWorkbook({ keyword: args.keyword, items: args.items, details: args.details }));
  });

  // 範圍整理表
  ipcMain.handle('law:resolve', async (_e, args: { name: string }) => {
    return resolveStatute(args.name);
  });
  ipcMain.handle('law:current', async (_e, args: { pcode: string }) => {
    return currentLawFor(args.pcode);
  });
  ipcMain.handle('scope:run', async (e, args: { statutes: string[]; yearFrom?: number; yearTo?: number; maxItems: number }) => {
    const ai = await requireAi();
    const sheets: ScopeSheet[] = [];
    const notes: string[] = [];
    const client = new CourtClient();
    for (const line of args.statutes) {
      const { name, citation } = splitStatuteLine(line);
      e.sender.send('scope:progress', { statute: name, done: 0, total: 1, phase: '確認法名與法條沿革' });
      const statute = await resolveStatute(name);
      if (statute.note) notes.push(statute.note);
      const lawHistory = await lawHistoryFor(statute.name);
      let rows: ScopeRow[] = await buildScopeTable({
        statute: statute.name,
        yearFrom: args.yearFrom,
        yearTo: args.yearTo,
        maxItems: args.maxItems,
        client,
        lawHistory,
        onProgress: (done, total) => e.sender.send('scope:progress', { statute: statute.name, done, total, phase: '篩選判決' }),
      });
      if (citation) rows = rows.filter((r) => rowCites(r, citation));
      const analyses: CaseAnalysis[] = [];
      for (let i = 0; i < rows.length; i++) {
        e.sender.send('scope:progress', { statute: statute.name, done: i + 1, total: rows.length, phase: 'AI 逐案分析' });
        const d = await cachedDetail(rows[i].id, client);
        analyses.push(await analyzeCase(ai, statute.name, rows[i], d));
      }
      e.sender.send('scope:progress', { statute: statute.name, done: 1, total: 1, phase: 'AI 綜合分析' });
      const synthesis: ScopeSynthesis | null = rows.length
        ? await synthesizeScope(ai, statute.name, analyses)
        : null;
      sheets.push({ statute: citation ? `${statute.name}${line.trim().slice(name.length)}` : statute.name, rows, analyses, synthesis });
    }
    const total = sheets.reduce((n, sh) => n + sh.rows.length, 0);
    await library().add({
      kind: 'scope',
      title: `範圍整理：${args.statutes.join('、')}`,
      summary: `${sheets.length} 部法規，共 ${total} 筆`,
      payload: { sheets, yearFrom: args.yearFrom, yearTo: args.yearTo },
    });
    return { sheets, notes };
  });
  ipcMain.handle('export:scope', async (_e, args: { sheets: ScopeSheet[]; yearFrom?: number; yearTo?: number; format: 'xlsx' | 'docx' }) => {
    const ext = args.format;
    const meta = { yearFrom: args.yearFrom, yearTo: args.yearTo };
    const buf = ext === 'xlsx'
      ? await buildScopeWorkbook(args.sheets, meta)
      : await buildScopeDocx(args.sheets, meta);
    return autoSaveExport(`範圍整理表_${stamp()}.${ext}`, buf);
  });

  // 檔案管理
  ipcMain.handle('library:list', async (_e, args: { status?: LibraryStatus }) => library().list(args?.status));
  ipcMain.handle('library:update', async (_e, args: { id: string; patch: { status?: LibraryStatus; starred?: boolean } }) => {
    await library().update(args.id, args.patch);
    return { ok: true };
  });
  ipcMain.handle('library:remove', async (_e, args: { id: string }) => {
    return { removed: await library().removePermanently(args.id) };
  });

  // 懸浮 AI 助理：查詢類工具直接執行；會花費額度的操作只會列為待確認（見 assistant.ts）
  ipcMain.handle('assistant:chat', async (_e, args: { history: { role: 'user' | 'assistant'; text: string }[]; text: string }) => {
    const turn: AssistantTurn = await runAssistantTurn(
      { config: aiConfigOrThrow, execute: executeAssistantTool },
      args.history.slice(-12),
      args.text,
    );
    return turn;
  });

  // 單一判決：先搜尋、列出候選，再由使用者指定一則（鎖定單一判決）
  ipcMain.handle('judgment:find', async (_e, args: { query: string }) => {
    const seen = new Map<string, JudgmentSummary>();
    let note = '';
    for (const q of judgmentQueries(args.query)) {
      try {
        for (const it of await cachedSearch(q, 20)) if (!seen.has(it.id)) seen.set(it.id, it);
      } catch (err) {
        // 查無結果或暫時被限制查詢：不中斷，回報說明即可
        const msg = err instanceof Error ? err.message : String(err);
        note = /查無|風控/.test(msg) ? '司法院網站沒有查到結果，或暫時限制查詢，請稍後再試或換關鍵字。' : msg;
      }
    }
    return { items: [...seen.values()].slice(0, 30), note };
  });

  // 單一判決精讀
  ipcMain.handle('brief:run', async (_e, args: { judgmentId: string; focus: string; lengthHint: string; fields?: BriefField[] }) => {
    const ai = await requireAi();
    const d = await cachedDetail(args.judgmentId);
    const fields = normalizeBriefFields(args.fields ?? []);
    const doc: BriefDocument = await briefJudgment(ai, d, { focus: args.focus, length: args.lengthHint, fields: fields.length ? fields : undefined });
    await library().add({
      kind: 'brief',
      title: `精讀：${d.meta.title || args.judgmentId}`,
      summary: d.meta.court ?? '',
      payload: { detail: d, doc },
    });
    const annotated = await annotateOriginalPdf(d, doc).catch((err) => ({ error: err instanceof Error ? err.message : String(err), files: [] as string[] }));
    return { detail: d, doc, annotated };
  });
  ipcMain.handle('export:brief', async (_e, args: { detail: JudgmentDetail; doc: BriefDocument }) => {
    return autoSaveExport(`判決精讀_${args.detail.meta.caseNo ?? args.detail.meta.id}.docx`, await buildBriefDocx(args.detail, args.doc));
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
