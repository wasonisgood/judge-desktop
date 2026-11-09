// 本地模組的主程序端（3.1）：
// - 架構：以 Win32_Processor 判讀原生架構（ARM64 上 Node/Electron 是模擬執行，不能看 process.arch）。
// - 引擎：Ollama 官方 zip（免安裝），以 GitHub 提供的 SHA-256 校驗，解壓到本程式資料夾，由我們自己啟動在獨立埠。
// - 既有服務：版本夠新就沿用；太舊就不動它，改用我們自己的新版（另一個埠）。
// - 模型：方案所需且已存在者跳過；其他已安裝的模型保留不刪。
// - 排除問題：收集事實 → 核心的診斷規則判讀 → 每項附修復按鈕；可匯出報告。
// - 模組更新：從模組目錄（modules.json）比對，只下載變動檔案，驗證失敗自動回滾。
// 判斷邏輯都在 @judge/core（有單元測試）；這裡負責與系統、檔案、Ollama、網路互動。
import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import {
  planLocalAI, parseHardware, runNetworkProbe, getOllamaVersion, hasModel, pullModel,
  OllamaBackend, OLLAMA_DEFAULT_URL, LOCAL_RULES_VERSION, BUILTIN_RULES, validateRules, DEFAULT_TARGETS,
  ModuleRegistry, installCrawlerModule, searchJudgments, downloadWithResume, ensureEngineRunning,
  withRetry, classifyError, repairPlan, parseSignatureJson, isTrustedSignature, buildFailureReport,
  nativeArchFromWmi, ollamaAssetFor, findVerifiedAsset, isSafeZipEntry, decideExistingEngine,
  modelsToPull, runDiagnostics, summarize, formatDiagnosticReport, validateCatalog, planCatalogUpdate,
  applyModuleUpdate, readInstalledModule, discardPrevious, sha256File, compareVersions,
  type ModuleId, type ModuleState, type HardwareInfo, type LocalPlan, type RepairActionId,
  type NativeArch, type EngineRules, type DiagFacts, type DiagSummary, type ModuleCatalog,
  type ModulePlan, type GithubAssetJson, type ProbeTarget,
} from '@judge/core';

// adm-zip 是既有依賴，這裡以 CommonJS 方式載入。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip: new (file: string) => { getEntries(): { entryName: string }[]; extractAllTo(dir: string, overwrite: boolean): void } = require('adm-zip');

export const AI_ENGINE_MODULE_ID: ModuleId = 'ai-engine';
const EXTERNAL_BASE = OLLAMA_DEFAULT_URL; // 使用者既有的服務
const OWN_PORT = 11435; // 本程式自己的服務，避免與既有服務衝突
const OWN_BASE = `http://127.0.0.1:${OWN_PORT}`;
const GITHUB_RELEASE_API = 'https://api.github.com/repos/ollama/ollama/releases/latest';
const DEFAULT_CATALOG_URL = 'https://github.com/wasonisgood/judge-desktop/releases/latest/download/modules.json';
const MODULE_IDS: ModuleId[] = ['ai-engine', 'crawler'];

export type PlanChoice = 'recommended' | 'light' | 'skip';

export interface PlanOption {
  id: PlanChoice;
  label: string;
  plan: LocalPlan;
}

export interface StageEvent {
  module: ModuleId;
  stage: string;
  status: 'start' | 'done' | 'failed' | 'progress' | 'retry';
  detail?: string;
  completed?: number;
  total?: number;
}

interface EngineRecord {
  mode: 'own' | 'external' | null;
  baseUrl: string | null;
  version: string | null;
  asset: string | null;
  arch: NativeArch | null;
  zipSha256: string | null;
  exePath: string | null;
  exeSha256: string | null;
  installedAt: string | null;
}

const EMPTY_ENGINE: EngineRecord = { mode: null, baseUrl: null, version: null, asset: null, arch: null, zipSha256: null, exePath: null, exeSha256: null, installedAt: null };

// ---------------------------------------------------------------------------
// 路徑
// ---------------------------------------------------------------------------
const userData = () => app.getPath('userData');
const modulesRoot = () => path.join(userData(), 'modules');
const moduleCurrent = (id: ModuleId) => path.join(modulesRoot(), id, 'current');
const engineRoot = () => path.join(userData(), 'engine');
// 內建模組位置以編譯後的檔案為準（dist/main → ../../modules）。不可用 app.getAppPath()：
// 在 electron 以腳本啟動時它會指向腳本所在資料夾。打包後 modules/** 也會一起進入應用程式。
const bundledModuleDir = (id: ModuleId) => path.join(__dirname, '..', '..', 'modules', id);

// ---------------------------------------------------------------------------
// 系統與 PowerShell（唯讀）
// ---------------------------------------------------------------------------
function runPowerShell(script: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('系統查詢逾時')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`系統查詢失敗（代碼 ${code}）：${err.slice(0, 200)}`));
    });
  });
}

/** 原生 CPU 架構（不是模擬後的 process.arch）。 */
export async function detectNativeArch(): Promise<NativeArch> {
  if (process.platform !== 'win32') return 'unknown';
  const raw = await runPowerShell('(Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture');
  return nativeArchFromWmi(raw.trim());
}

export async function detectHardware(): Promise<HardwareInfo> {
  if (process.platform !== 'win32') throw new Error('本地 AI 目前只支援 Windows');
  const script = [
    '$cs = Get-CimInstance Win32_ComputerSystem',
    '$gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM)',
    '$free = (Get-PSDrive -Name ($env:SystemDrive.TrimEnd(":"))).Free',
    '[pscustomobject]@{ totalMemoryBytes = $cs.TotalPhysicalMemory; freeDiskBytes = $free;',
    '  gpus = @($gpu | ForEach-Object { [pscustomobject]@{ name = $_.Name; adapterRamBytes = $_.AdapterRAM } }) } | ConvertTo-Json -Depth 4 -Compress',
  ].join('\n');
  const raw = JSON.parse(await runPowerShell(script));
  return parseHardware({ totalMemoryBytes: raw.totalMemoryBytes, freeDiskBytes: raw.freeDiskBytes, gpus: raw.gpus });
}

async function authenticodeStatus(file: string): Promise<string> {
  const script = `Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}' | Select-Object @{n='Status';e={$_.Status.ToString()}}, @{n='Subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`;
  return parseSignatureJson(await runPowerShell(script)).status;
}

// ---------------------------------------------------------------------------
// 狀態檔（每個模組各自一份；引擎紀錄獨立）
// ---------------------------------------------------------------------------
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export async function loadRegistry(): Promise<ModuleRegistry> {
  return new ModuleRegistry(await readJson(path.join(modulesRoot(), 'registry.json'), {} as any));
}
async function saveRegistry(reg: ModuleRegistry): Promise<void> {
  await writeJson(path.join(modulesRoot(), 'registry.json'), reg.toJSON());
}
async function setModule(id: ModuleId, patch: Partial<ModuleState>): Promise<ModuleState> {
  const reg = await loadRegistry();
  const next = reg.set(id, patch);
  await saveRegistry(reg);
  broadcast('local:changed', { id, state: next }); // 設定頁與精靈即時更新
  return next;
}

// 安裝任務狀態保存在主程序：關閉精靈不會中斷安裝，重新開啟時可還原進度。
type JobKind = 'install' | 'repair' | 'crawler' | null;
const job: { running: boolean; kind: JobKind; events: StageEvent[]; result: ModuleState | null } = { running: false, kind: null, events: [], result: null };

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function emitStage(ev: StageEvent): void {
  job.events.push(ev);
  if (job.events.length > 300) job.events.shift();
  broadcast('local:progress', ev);
}

export function jobStatus(): { running: boolean; kind: JobKind; events: StageEvent[]; result: ModuleState | null } {
  return { running: job.running, kind: job.kind, events: [...job.events], result: job.result };
}

async function runAsJob<T extends ModuleState>(kind: Exclude<JobKind, null>, work: () => Promise<T>): Promise<T> {
  // 已有任務在執行（例如修復時呼叫安裝）：併入同一個任務，不另外開新的。
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
export async function readModuleStatus(): Promise<Record<ModuleId, ModuleState>> {
  return (await loadRegistry()).toJSON();
}

const readEngine = () => readJson<EngineRecord>(path.join(engineRoot(), 'engine.json'), EMPTY_ENGINE);
const writeEngine = (r: EngineRecord) => writeJson(path.join(engineRoot(), 'engine.json'), r);
const readPlan = () => readJson<LocalPlan | null>(path.join(engineRoot(), 'plan.json'), null);
const writePlan = (p: LocalPlan) => writeJson(path.join(engineRoot(), 'plan.json'), p);

// ---------------------------------------------------------------------------
// 模組檔案：首次使用時從應用程式內建複製到 current；之後只由「模組更新」改動。
// ---------------------------------------------------------------------------
async function ensureBundledModules(): Promise<void> {
  for (const id of MODULE_IDS) {
    const cur = moduleCurrent(id);
    if (fsSync.existsSync(path.join(cur, 'manifest.json'))) continue;
    const src = bundledModuleDir(id);
    const meta = await readJson<{ version: string }>(path.join(src, 'module.json'), { version: '0.0.0' });
    await fs.rm(cur, { recursive: true, force: true });
    await fs.mkdir(cur, { recursive: true });
    const files: Record<string, string> = {};
    for (const name of await fs.readdir(src)) {
      if (name === 'module.json') continue;
      await fs.copyFile(path.join(src, name), path.join(cur, name));
      files[name] = await sha256File(path.join(cur, name));
    }
    await writeJson(path.join(cur, 'manifest.json'), { moduleId: id, version: meta.version, files: Object.fromEntries(Object.entries(files)) });
    await setModule(id, { installedVersion: meta.version, status: 'not-installed' });
  }
}

/** 目前生效的分級規則：模組 current/rules.json 有效就用它，否則用內建。 */
export async function loadActiveRules(): Promise<{ rules: EngineRules; source: 'module' | 'builtin'; error: string | null }> {
  const raw = await readJson<unknown>(path.join(moduleCurrent(AI_ENGINE_MODULE_ID), 'rules.json'), null);
  if (!raw) return { rules: BUILTIN_RULES, source: 'builtin', error: null };
  const v = validateRules(raw);
  if (v.ok) return { rules: v.rules, source: 'module', error: null };
  return { rules: BUILTIN_RULES, source: 'builtin', error: v.error };
}

/** 網路探測目標：模組 current/endpoints.json 有效就用它，否則用內建。 */
async function activeProbeTargets(): Promise<ProbeTarget[]> {
  const e = await readJson<{ probes?: ProbeTarget[] }>(path.join(moduleCurrent('crawler'), 'endpoints.json'), {});
  return Array.isArray(e.probes) && e.probes.length ? e.probes : DEFAULT_TARGETS;
}

// ---------------------------------------------------------------------------
// 方案
// ---------------------------------------------------------------------------
/** 第一階段：檢查與方案選項（不安裝任何東西）。 */
export async function planForUi(): Promise<{
  hardware: HardwareInfo;
  nativeArch: NativeArch;
  network: Awaited<ReturnType<typeof runNetworkProbe>>;
  options: PlanOption[];
  registry: Record<ModuleId, ModuleState>;
  rulesSource: 'module' | 'builtin';
}> {
  await ensureBundledModules();
  const { rules, source } = await loadActiveRules();
  const hardware = await detectHardware();
  const nativeArch = await detectNativeArch();
  await writeJson(path.join(engineRoot(), 'hardware.json'), { hardware, nativeArch, at: new Date().toISOString() });
  const recommended = planLocalAI(hardware, rules);
  const network = await runNetworkProbe({ targets: await activeProbeTargets() });
  const options: PlanOption[] = [];
  if (recommended.tier !== 'none') {
    options.push({ id: 'recommended', label: '推薦方案', plan: recommended });
    if (recommended.tier !== 'light') {
      const l = rules.tiers.light;
      options.push({
        id: 'light', label: '較輕方案',
        plan: { tier: 'light', judgmentModel: l.judgment, chatModel: l.judgment, installBoth: false, requiredDiskGB: l.diskGB, reasons: ['較輕方案：下載較小、回應較快，但精讀品質可能較低'] },
      });
    }
  }
  options.push({
    id: 'skip', label: '不安裝（只用雲端）',
    plan: { tier: 'none', judgmentModel: null, chatModel: null, installBoth: false, requiredDiskGB: 0, reasons: ['不安裝本地 AI，所有 AI 功能使用雲端'] },
  });
  return { hardware, nativeArch, network, options, registry: await readModuleStatus(), rulesSource: source };
}

export async function setSkipAi(): Promise<ModuleState> {
  return setModule(AI_ENGINE_MODULE_ID, { status: 'disabled', lastError: null, failedStage: null });
}

// ---------------------------------------------------------------------------
// 引擎：下載、校驗、解壓、啟動
// ---------------------------------------------------------------------------
function engineBaseOverride(): string | null {
  return process.env.JUDGE_OLLAMA_URL || null; // 測試用：指向模擬服務，不安裝任何東西
}

async function fetchLatestAsset(name: string): Promise<{ name: string; size: number; sha256: string; url: string }> {
  const override = process.env.JUDGE_OLLAMA_ZIP_URL;
  if (override) {
    const sha = process.env.JUDGE_OLLAMA_ZIP_SHA256 || '';
    if (!/^[0-9a-f]{64}$/i.test(sha)) throw new Error('測試用引擎網址缺少 JUDGE_OLLAMA_ZIP_SHA256');
    return { name, size: 0, sha256: sha.toLowerCase(), url: override };
  }
  const res = await fetch(GITHUB_RELEASE_API, { headers: { 'user-agent': 'judge-desktop', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`無法取得引擎版本資訊（HTTP ${res.status}）`);
  const json = (await res.json()) as { tag_name: string; assets: GithubAssetJson[] };
  const a = findVerifiedAsset(json.assets, name);
  if (!a || !a.url) throw new Error(`找不到已驗證摘要的引擎資產 ${name}（沒有 SHA-256，拒絕安裝）`);
  return { name, size: a.size, sha256: a.sha256, url: a.url };
}

async function findExe(dir: string): Promise<string | null> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === 'ollama.exe') return full;
    if (e.isDirectory()) {
      const inner = await findExe(full);
      if (inner) return inner;
    }
  }
  return null;
}

/** 下載 zip（可續傳、SHA-256 校驗）並解壓到 engine/bin。回傳 ollama.exe 路徑與 zip 摘要。 */
async function installEngineFiles(arch: NativeArch, send: (ev: StageEvent) => void): Promise<{ exe: string; zipSha256: string; asset: string }> {
  const assetName = ollamaAssetFor(arch);
  if (!assetName) throw new Error(`不支援的 CPU 架構 ${arch}，無法安裝本地引擎`);
  const asset = await fetchLatestAsset(assetName);
  const zipFile = path.join(engineRoot(), 'download', assetName);

  // 先檢查本機是否已有相同版本（同一個 SHA-256）且完整的引擎：有就直接沿用，不重新下載或解壓。
  const prev = await readEngine();
  if (prev.zipSha256 === asset.sha256 && prev.exePath && fsSync.existsSync(prev.exePath) && prev.exeSha256) {
    if ((await sha256File(prev.exePath)) === prev.exeSha256) {
      send({ module: 'ai-engine', stage: 'installEngine', status: 'progress', detail: '本機已有相同版本的引擎，略過下載與解壓' });
      return { exe: prev.exePath, zipSha256: asset.sha256, asset: assetName };
    }
  }

  // 下載：若下載資料夾內已有相同摘要的 zip，直接使用，不再從網路下載。
  const haveZip = fsSync.existsSync(zipFile) && (await sha256File(zipFile)) === asset.sha256;
  if (!haveZip) {
    await withRetry(
      () => downloadWithResume({
        url: asset.url, file: zipFile, expectedSha256: asset.sha256,
        onProgress: (d, t) => send({ module: 'ai-engine', stage: 'installEngine', status: 'progress', detail: '下載引擎', completed: d, total: t ?? undefined }),
      }),
      { attempts: 3, baseDelayMs: 2000, onRetry: (n, delay) => send({ module: 'ai-engine', stage: 'installEngine', status: 'retry', detail: `第 ${n} 次重試（${delay / 1000} 秒後）` }) },
    );
  }
  const bin = path.join(engineRoot(), 'bin');
  await fs.rm(bin, { recursive: true, force: true });
  await fs.mkdir(bin, { recursive: true });
  const zip = new AdmZip(zipFile);
  for (const e of zip.getEntries()) {
    if (!isSafeZipEntry(e.entryName)) throw new Error(`引擎壓縮檔含不安全的路徑：${e.entryName}`);
  }
  zip.extractAllTo(bin, true);
  const exe = await findExe(bin);
  if (!exe) throw new Error('解壓後找不到 ollama.exe（INSTALLER_FAILED）');
  return { exe, zipSha256: asset.sha256, asset: assetName };
}

function startOwnService(exe: string): void {
  const child = spawn(exe, ['serve'], {
    windowsHide: true, detached: true, stdio: 'ignore',
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${OWN_PORT}`, OLLAMA_MODELS: path.join(engineRoot(), 'models') },
  });
  child.on('error', (e) => console.error('本地服務無法啟動（SERVICE_DOWN）：', e.message));
  child.unref();
}

// ---------------------------------------------------------------------------
// 安裝精靈（AI 引擎模組）
// ---------------------------------------------------------------------------
export interface InstallOptions {
  /** 強制重新安裝自己的引擎（不沿用既有服務）。 */
  forceOwnEngine?: boolean;
}

/** 安裝 AI 引擎模組（作為主程序的背景任務；畫面只是觀看者）。 */
export async function installAiEngineModule(plan: LocalPlan, _send: (ev: StageEvent) => void, opts: InstallOptions = {}): Promise<ModuleState> {
  return runAsJob('install', () => installAiEngineModuleCore(plan, emitStage, opts));
}

async function installAiEngineModuleCore(plan: LocalPlan, send: (ev: StageEvent) => void, opts: InstallOptions = {}): Promise<ModuleState> {
  if (plan.tier === 'none' || !plan.judgmentModel || !plan.chatModel) throw new Error('所選方案為不安裝，沒有需要安裝的模型');
  await ensureBundledModules();
  const { rules } = await loadActiveRules();
  const required = [...new Set([plan.judgmentModel, plan.chatModel])];
  const ev = (stage: string, status: StageEvent['status'], extra: Partial<StageEvent> = {}) => send({ module: AI_ENGINE_MODULE_ID, stage, status, ...extra });
  let stage = 'checkSystem';
  await setModule(AI_ENGINE_MODULE_ID, { status: 'installing', lastError: null, failedStage: null });
  try {
    await ev(stage, 'start');
    // 系統偵測失敗不應中斷安裝：改用方案選擇時快取的結果（硬體資訊不會在安裝途中改變）。
    let hw: HardwareInfo;
    let arch: NativeArch;
    let source = '本次偵測';
    try {
      hw = await detectHardware();
      arch = await detectNativeArch();
      await writeJson(path.join(engineRoot(), 'hardware.json'), { hardware: hw, nativeArch: arch, at: new Date().toISOString() });
    } catch (e: any) {
      const cached = await readJson<{ hardware: HardwareInfo; nativeArch: NativeArch; at: string } | null>(path.join(engineRoot(), 'hardware.json'), null);
      if (!cached) throw new Error(`系統偵測失敗且沒有先前的紀錄（${e?.message ?? e}）`);
      hw = cached.hardware;
      arch = cached.nativeArch;
      source = `先前偵測（${cached.at.slice(0, 16).replace('T', ' ')}）`;
    }
    await ev(stage, 'done', { detail: `記憶體 ${hw.ramGB} GB，磁碟可用 ${hw.freeDiskGB} GB，CPU ${arch}（${source}）` });

    stage = 'checkNetwork';
    await ev(stage, 'start');
    const net = await runNetworkProbe({ targets: await activeProbeTargets() });
    if (!net.ready) throw new Error(`網路檢查未通過：${net.messages.join('；')}`);
    await ev(stage, 'done');

    stage = 'decideEngine';
    await ev(stage, 'start');
    const override = engineBaseOverride();
    let base: string;
    let mode: 'own' | 'external';
    let decisionText: string;
    if (override) {
      base = override; mode = 'external'; decisionText = '測試模式：使用指定的模擬服務';
    } else {
      const ext = await getOllamaVersion({ baseUrl: EXTERNAL_BASE });
      const d = decideExistingEngine(ext, rules.minEngineVersion);
      decisionText = d.reason;
      if (d.action === 'adopt' && !opts.forceOwnEngine) { base = EXTERNAL_BASE; mode = 'external'; }
      else {
        // 使用自己的引擎：若已在執行且版本夠新就直接沿用。
        const own = await getOllamaVersion({ baseUrl: OWN_BASE });
        base = OWN_BASE; mode = 'own';
        if (own && compareVersions(own, rules.minEngineVersion)! >= 0 && !opts.forceOwnEngine) decisionText += '；本程式的引擎已在執行，沿用';
      }
    }
    await ev(stage, 'done', { detail: decisionText });

    let engine = await readEngine();
    stage = 'installEngine';
    if (mode === 'own' && !(await getOllamaVersion({ baseUrl: OWN_BASE })) || opts.forceOwnEngine) {
      await ev(stage, 'start');
      const installed = await installEngineFiles(arch, (e) => send({ ...e, module: AI_ENGINE_MODULE_ID }));
      const exeSha = await sha256File(installed.exe);
      engine = { ...EMPTY_ENGINE, mode: 'own', baseUrl: OWN_BASE, asset: installed.asset, arch, zipSha256: installed.zipSha256, exePath: installed.exe, exeSha256: exeSha, installedAt: new Date().toISOString() };
      await writeEngine(engine);
      await ev(stage, 'done', { detail: `已解壓 ${installed.asset}` });
    } else {
      await ev(stage, 'done', { detail: mode === 'external' ? '沿用既有服務，不另外安裝' : '本程式的引擎已存在' });
    }

    stage = 'startService';
    await ev(stage, 'start');
    if (mode === 'own' && !(await getOllamaVersion({ baseUrl: OWN_BASE }))) {
      if (!engine.exePath || !fsSync.existsSync(engine.exePath)) throw new Error('引擎執行檔不存在，請重新安裝引擎（SERVICE_DOWN）');
      startOwnService(engine.exePath);
    }
    await ev(stage, 'done');

    stage = 'verifyEngine';
    await ev(stage, 'start');
    const health = await ensureEngineRunning({
      baseUrl: base,
      startService: mode === 'own' && engine.exePath && !override ? () => startOwnService(engine.exePath!) : undefined,
      maxWaitMs: 60_000, maxStartAttempts: 2,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    if (!health.ok || !health.version) throw new Error('本地服務沒有回應（SERVICE_DOWN）');
    if (compareVersions(health.version, rules.minEngineVersion)! < 0 && !override) {
      throw new Error(`引擎版本 ${health.version} 低於需求 ${rules.minEngineVersion}（INSTALLER_FAILED）`);
    }
    engine = { ...engine, mode, baseUrl: base, version: health.version };
    await writeEngine(engine);
    await ev(stage, 'done', { detail: `服務版本 ${health.version}` });

    stage = 'pullModels';
    const installedModels = await listModels(base);
    for (const m of modelsToPull(required, installedModels)) {
      await ev(stage, 'start', { detail: m });
      await withRetry(
        () => pullModel(m, (p) => ev(stage, 'progress', { detail: m, completed: p.completed, total: p.total }), { baseUrl: base }),
        { attempts: 3, baseDelayMs: 2000, onRetry: (n, delay) => ev(stage, 'retry', { detail: `${m} 第 ${n} 次重試（${delay / 1000} 秒後）` }) },
      );
      await ev(stage, 'done', { detail: m });
    }
    if (modelsToPull(required, installedModels).length === 0) await ev(stage, 'done', { detail: '所需模型已存在，略過下載' });

    stage = 'smokeTest';
    await ev(stage, 'start');
    const backend = new OllamaBackend({ judgment: plan.judgmentModel, chat: plan.chatModel }, { baseUrl: base });
    for (const m of required) {
      const r = await backend.run<{ text: string }>(m === plan.judgmentModel ? 'judgment' : 'chat', { prompt: '請只回答：OK' });
      if (!r.text) throw new Error(`模型 ${m} 測試回應為空`);
    }
    await ev(stage, 'done');

    stage = 'register';
    await ev(stage, 'start');
    await writePlan(plan);
    const version = (await readJson<{ version: string }>(path.join(moduleCurrent(AI_ENGINE_MODULE_ID), 'manifest.json'), { version: null as any })).version;
    const state = await setModule(AI_ENGINE_MODULE_ID, { status: 'ready', installedVersion: version, lastError: null, failedStage: null });
    await ev(stage, 'done', { detail: `規則表版本 ${rules.rulesVersion}` });
    return state;
  } catch (e: any) {
    const c = classifyError(e);
    const rp = repairPlan(c.code);
    const msg = `${c.code}：${e?.message ?? String(e)}`;
    const st = await setModule(AI_ENGINE_MODULE_ID, { status: 'failed', lastError: `${msg}｜${rp.userSteps.join(' ')}`, failedStage: stage });
    ev(stage, 'failed', { detail: msg });
    await appendFailure(AI_ENGINE_MODULE_ID, stage, c.code, e);
    return st;
  }
}

async function listModels(base: string): Promise<string[]> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 排除問題：收集事實 → 核心判讀
// ---------------------------------------------------------------------------
async function collectFacts(): Promise<DiagFacts> {
  const { rules } = await loadActiveRules();
  const eng = await readEngine();
  const plan = await readPlan();
  const base = eng.baseUrl ?? (engineBaseOverride() || OWN_BASE);
  const nativeArch = await detectNativeArch();
  const serviceVersion = await getOllamaVersion({ baseUrl: base });
  const installedModels = serviceVersion ? await listModels(base) : [];
  const requiredModels = plan && plan.tier !== 'none' ? [...new Set([plan.judgmentModel!, plan.chatModel!])] : [];

  let chatSmokeOk: boolean | null = null;
  if (serviceVersion && requiredModels.length && requiredModels.every((m) => installedModels.includes(m))) {
    try {
      const b = new OllamaBackend({ judgment: requiredModels[0], chat: requiredModels[0] }, { baseUrl: base });
      const r = await b.run<{ text: string }>('chat', { prompt: '請只回答：OK' });
      chatSmokeOk = !!r.text;
    } catch {
      chatSmokeOk = false;
    }
  }

  let engineFileOk: boolean | null = null;
  let engineSignature: string | null = null;
  if (eng.exePath) {
    if (!fsSync.existsSync(eng.exePath)) engineFileOk = false;
    else {
      engineFileOk = eng.exeSha256 ? (await sha256File(eng.exePath)) === eng.exeSha256 : null;
      engineSignature = await authenticodeStatus(eng.exePath).catch(() => null);
    }
  }

  const hw = await detectHardware().catch(() => null);
  const probes = await activeProbeTargets();
  const net = await runNetworkProbe({ targets: probes });
  const general = net.results.find((r, i) => !probes[i].required);
  const judicial = net.results.find((r, i) => probes[i].required);
  const reg = await readModuleStatus();
  const failures = await readJson<{ stage: string; code: string }[]>(path.join(modulesRoot(), 'failures.json'), []);
  const last = failures.at(-1);
  void rules;

  return {
    nativeArch,
    engineArch: eng.mode === 'external' ? 'unknown' : eng.arch,
    engineFileOk,
    engineSignature,
    serviceVersion,
    requiredModels,
    installedModels,
    chatSmokeOk,
    freeDiskGB: hw?.freeDiskGB ?? 0,
    requiredDiskGB: plan?.requiredDiskGB ?? 0,
    network: { general: general ? general.ok : null, judicial: judicial ? judicial.ok : null },
    moduleStatus: reg[AI_ENGINE_MODULE_ID].status,
    recentFailure: last ? { code: last.code, stage: last.stage } : null,
    hasPlan: !!plan && plan.tier !== 'none',
  };
}

export async function diagnose(): Promise<DiagSummary> {
  return summarize(runDiagnostics(await collectFacts()));
}

export async function exportDiagnosticReport(): Promise<string> {
  const s = await diagnose();
  const reg = await readModuleStatus();
  const text = formatDiagnosticReport(s, {
    appVersion: app.getVersion(),
    moduleVersion: reg[AI_ENGINE_MODULE_ID].installedVersion,
    at: new Date().toISOString(),
    osVersion: `${os.type()} ${os.release()} ${os.arch()}`,
  });
  const file = path.join(userData(), 'diagnostics', `診斷報告-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// 修復動作
// ---------------------------------------------------------------------------
export async function runRepair(action: RepairActionId, _send: (ev: StageEvent) => void): Promise<ModuleState> {
  return runAsJob('repair', () => runRepairCore(action, emitStage));
}

async function runRepairCore(action: RepairActionId, send: (ev: StageEvent) => void): Promise<ModuleState> {
  const eng = await readEngine();
  const plan = await readPlan();
  const base = eng.baseUrl ?? (engineBaseOverride() || OWN_BASE);
  const ownExe = eng.mode === 'own' ? eng.exePath : null;

  if (action === 'restart-service') {
    if (eng.mode === 'own' && ownExe && fsSync.existsSync(ownExe)) {
      const h = await ensureEngineRunning({ baseUrl: base, startService: () => startOwnService(ownExe), maxWaitMs: 60_000, maxStartAttempts: 2, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
      if (!h.ok) throw new Error('重新啟動後服務仍沒有回應（SERVICE_DOWN）');
    } else {
      const v = await getOllamaVersion({ baseUrl: base });
      if (!v) throw new Error('既有服務沒有回應（SERVICE_DOWN）：請先啟動 Ollama，或在這裡重新安裝引擎');
    }
    return setModule(AI_ENGINE_MODULE_ID, { status: 'ready', lastError: null, failedStage: null });
  }
  if (action === 'repull-models') {
    if (!plan || plan.tier === 'none') throw new Error('沒有安裝方案紀錄，請重新檢查並安裝');
    for (const m of modelsToPull([plan.judgmentModel!, plan.chatModel!], await listModels(base))) {
      await withRetry(() => pullModel(m, (p) => send({ module: AI_ENGINE_MODULE_ID, stage: 'pullModels', status: 'progress', detail: m, completed: p.completed, total: p.total }), { baseUrl: base }), { attempts: 3, baseDelayMs: 2000 });
    }
    return setModule(AI_ENGINE_MODULE_ID, { status: 'ready', lastError: null, failedStage: null });
  }
  if (action === 'reinstall-engine' || action === 'redownload-installer') {
    if (action === 'redownload-installer') {
      const assetName = eng.asset ?? ollamaAssetFor(eng.arch ?? 'unknown');
      if (assetName) {
        await fs.rm(path.join(engineRoot(), 'download', assetName), { force: true });
        await fs.rm(path.join(engineRoot(), 'download', `${assetName}.part`), { force: true });
      }
    }
    if (!plan || plan.tier === 'none') throw new Error('沒有安裝方案紀錄，請重新檢查並安裝');
    return installAiEngineModule(plan, send, { forceOwnEngine: true });
  }
  if (action === 'reregister') {
    if (!plan || plan.tier === 'none') throw new Error('沒有安裝方案紀錄，請重新檢查並安裝');
    const s = await diagnose();
    const blocking = s.checks.filter((c) => c.status === 'fail' && c.id !== 'recent-failure');
    if (blocking.length) throw new Error(`仍有未解決的問題：${blocking.map((c) => c.title).join('、')}`);
    return setModule(AI_ENGINE_MODULE_ID, { status: 'ready', lastError: null, failedStage: null });
  }
  if (action === 'retry') {
    if (!plan || plan.tier === 'none') throw new Error('沒有安裝方案紀錄，請重新檢查並安裝');
    return installAiEngineModule(plan, send);
  }
  if (action === 'free-disk-space') throw new Error('請自行清出磁碟空間（至少需要所選方案的空間），完成後再按「重試」。');
  if (action === 'check-network-vpn') throw new Error('請確認網路連線；若使用 VPN，請切換節點或暫時關閉後再試。');
  throw new Error(`不支援的修復動作：${action}`);
}

// ---------------------------------------------------------------------------
// 爬取模組
// ---------------------------------------------------------------------------
export async function installCrawlerModuleForApp(send: (ev: StageEvent) => void): Promise<ModuleState> {
  await ensureBundledModules();
  await setModule('crawler', { status: 'installing', lastError: null, failedStage: null });
  const targets = await activeProbeTargets();
  const res = await installCrawlerModule({
    probe: () => runNetworkProbe({ targets }),
    smokeFetch: () => searchJudgments('損害賠償', { maxItems: 1 }),
    register: () => undefined,
  });
  for (const s of res.completed) send({ module: 'crawler', stage: s, status: 'done' });
  if (!res.ok && res.failedAt) {
    send({ module: 'crawler', stage: res.failedAt, status: 'failed', detail: res.error });
    const c = classifyError(new Error(res.error ?? ''));
    await appendFailure('crawler', res.failedAt, c.code, new Error(res.error ?? ''));
    return setModule('crawler', { status: 'failed', lastError: `${c.code}：${res.error}`, failedStage: res.failedAt });
  }
  const version = (await readJson<{ version: string }>(path.join(moduleCurrent('crawler'), 'manifest.json'), { version: null as any })).version;
  return setModule('crawler', { status: 'ready', installedVersion: version, lastError: null, failedStage: null });
}

// ---------------------------------------------------------------------------
// 模組更新（目錄比對、只下載變動、驗證失敗回滾）
// ---------------------------------------------------------------------------
export interface UpdateCheck {
  ok: boolean;
  error: string | null;
  catalogVersion: number | null;
  plans: ModulePlan[];
  appUpdateNeeded: boolean;
  catalogUrl: string;
}

function catalogUrl(): string {
  return process.env.JUDGE_MODULES_CATALOG_URL || DEFAULT_CATALOG_URL;
}

async function fetchCatalog(): Promise<ModuleCatalog> {
  const res = await fetch(catalogUrl(), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`無法取得模組目錄（HTTP ${res.status}）`);
  const v = validateCatalog(await res.json());
  if (!v.ok) throw new Error(`模組目錄無效：${v.error}`);
  return v.catalog;
}

async function planAll(catalog: ModuleCatalog): Promise<ModulePlan[]> {
  const plans: ModulePlan[] = [];
  for (const id of MODULE_IDS) {
    const target = catalog.modules[id];
    if (!target) continue;
    const installed = await readInstalledModule(moduleCurrent(id));
    plans.push(planCatalogUpdate(id, installed, target));
  }
  return plans;
}

export async function checkModuleUpdates(): Promise<UpdateCheck> {
  await ensureBundledModules();
  try {
    const catalog = await fetchCatalog();
    const plans = await planAll(catalog);
    return { ok: true, error: null, catalogVersion: catalog.catalogVersion, plans, appUpdateNeeded: plans.some((p) => p.requiresAppUpdate && !p.upToDate), catalogUrl: catalogUrl() };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), catalogVersion: null, plans: [], appUpdateNeeded: false, catalogUrl: catalogUrl() };
  }
}

/** 套用可更新的模組。每個模組獨立：一個失敗不影響另一個。 */
export async function applyModuleUpdates(send: (ev: StageEvent) => void): Promise<{ results: { module: ModuleId; ok: boolean; message: string }[] }> {
  const check = await checkModuleUpdates();
  if (!check.ok) return { results: [{ module: 'ai-engine', ok: false, message: check.error ?? '檢查失敗' }] };
  const catalog = await fetchCatalog();
  const results: { module: ModuleId; ok: boolean; message: string }[] = [];
  for (const p of check.plans) {
    if (p.upToDate) { results.push({ module: p.moduleId, ok: true, message: `已是最新版本 ${p.toVersion}` }); continue; }
    if (p.requiresAppUpdate) { results.push({ module: p.moduleId, ok: false, message: `版本 ${p.toVersion} 需要更新應用程式，請安裝新版程式` }); continue; }
    const target = catalog.modules[p.moduleId]!;
    const r = await applyModuleUpdate({
      moduleId: p.moduleId,
      moduleDir: moduleCurrent(p.moduleId),
      target,
      onProgress: (msg) => send({ module: p.moduleId, stage: 'update', status: 'progress', detail: msg }),
      verify: async (dir) => {
        if (p.moduleId === 'ai-engine') {
          const v = validateRules(await readJson<unknown>(path.join(dir, 'rules.json'), null));
          return v.ok ? null : `規則表無效：${v.error}`;
        }
        const e = await readJson<{ probes?: unknown[] }>(path.join(dir, 'endpoints.json'), {});
        return Array.isArray(e.probes) && e.probes.length ? null : '端點設定無效';
      },
    });
    if (r.ok) {
      await discardPrevious(moduleCurrent(p.moduleId));
      await setModule(p.moduleId, { installedVersion: r.version, lastError: null });
      results.push({ module: p.moduleId, ok: true, message: `已更新到 ${r.version}（下載 ${r.downloaded.length} 個檔案，沿用 ${r.reused.length} 個）` });
    } else {
      results.push({ module: p.moduleId, ok: false, message: r.error ?? '更新失敗' });
    }
  }
  return { results };
}

// ---------------------------------------------------------------------------
// 執行期：供 requireAi 使用
// ---------------------------------------------------------------------------
/** AI 引擎模組為 ready 且服務可用時，回傳本地後端；否則 null（雲端）。 */
export async function localBackendIfReady(): Promise<{ kind: 'local'; run: <T>(task: 'judgment' | 'chat' | 'crawl', payload: unknown) => Promise<T> } | null> {
  const st = (await readModuleStatus())[AI_ENGINE_MODULE_ID];
  const plan = await readPlan();
  if (st.status !== 'ready' || !plan || plan.tier === 'none' || !plan.judgmentModel || !plan.chatModel) return null;
  const eng = await readEngine();
  const base = eng.baseUrl ?? (engineBaseOverride() || OWN_BASE);
  const ollama = new OllamaBackend({ judgment: plan.judgmentModel, chat: plan.chatModel }, { baseUrl: base });
  return {
    kind: 'local',
    run: async <T>(task: 'judgment' | 'chat' | 'crawl', payload: unknown) => {
      const r = await ollama.run<{ text: string }>(task, payload);
      return r.text as unknown as T;
    },
  };
}

async function appendFailure(module: ModuleId, stage: string, code: string, e: unknown): Promise<void> {
  const f = path.join(modulesRoot(), 'failures.json');
  const list = await readJson<unknown[]>(f, []);
  const report = buildFailureReport({
    appVersion: app.getVersion(), rulesVersion: LOCAL_RULES_VERSION, stage: `${module}/${stage}`,
    tier: 'n/a', osVersion: `${os.type()} ${os.release()} ${os.arch()}`, message: `${code} ${(e as Error)?.message ?? ''}`,
  });
  list.push({ at: new Date().toISOString(), ...report });
  await writeJson(f, list.slice(-50));
}

export { LOCAL_RULES_VERSION };
