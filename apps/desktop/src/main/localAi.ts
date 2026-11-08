// 本地模組的主程序端：硬體偵測（PowerShell，唯讀）、方案選項、兩個獨立模組的安裝與修復、狀態保存。
// 判斷邏輯與引擎穩定性都在 @judge/core（有單元測試）；這裡只負責與作業系統、Ollama、司法院網站互動。
import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import {
  planLocalAI, parseHardware, runNetworkProbe, getOllamaVersion, hasModel, pullModel,
  OllamaBackend, OLLAMA_DEFAULT_URL, LOCAL_RULES_VERSION, MODEL_TABLE,
  ModuleRegistry, installCrawlerModule, searchJudgments,
  downloadWithResume, ensureEngineRunning, withRetry, classifyError, repairPlan,
  parseSignatureJson, isTrustedSignature, buildFailureReport, type ModuleId, type ModuleState,
  type HardwareInfo, type LocalPlan, type RouterBackend, type RepairActionId,
  type ClassifiedError,
} from '@judge/core';

export const OLLAMA_SETUP_URL = 'https://ollama.com/download/OllamaSetup.exe';
export const AI_ENGINE_MODULE_VERSION = '1.0.0';
export const CRAWLER_MODULE_VERSION = '1.0.0';
const OLLAMA_PUBLISHER = 'Ollama';

/** 測試用：指定假的 Ollama 位址（煙霧測試會啟動模擬服務），正式使用時不設定。 */
export function engineBaseUrl(): string {
  return process.env.JUDGE_OLLAMA_URL || OLLAMA_DEFAULT_URL;
}

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

// ---------------------------------------------------------------------------
// 狀態（每個模組各自一份，存在 userData/modules/registry.json）
// ---------------------------------------------------------------------------
function modulesDir(): string {
  return path.join(app.getPath('userData'), 'modules');
}
function registryFile(): string {
  return path.join(modulesDir(), 'registry.json');
}

export async function loadRegistry(): Promise<ModuleRegistry> {
  try {
    return new ModuleRegistry(JSON.parse(await fs.readFile(registryFile(), 'utf8')));
  } catch {
    return new ModuleRegistry();
  }
}

async function saveRegistry(reg: ModuleRegistry): Promise<void> {
  await fs.mkdir(modulesDir(), { recursive: true });
  await fs.writeFile(registryFile(), JSON.stringify(reg.toJSON(), null, 2), 'utf8');
}

/** 寫入單一模組狀態；只改該模組，另一個模組維持原值。 */
async function setModule(id: ModuleId, patch: Partial<ModuleState>): Promise<ModuleState> {
  const reg = await loadRegistry();
  const next = reg.set(id, patch);
  await saveRegistry(reg);
  return next;
}

export async function readModuleStatus(): Promise<Record<ModuleId, ModuleState>> {
  return (await loadRegistry()).toJSON();
}

// ---------------------------------------------------------------------------
// 硬體偵測（唯讀）
// ---------------------------------------------------------------------------
function runPowerShell(script: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('硬體查詢逾時')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`硬體查詢失敗（代碼 ${code}）：${err.slice(0, 200)}`));
    });
  });
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

/**
 * 第一階段：檢查與方案選項（不安裝任何東西）。
 * 選項：推薦方案、較輕方案（若推薦不是最輕）、不安裝（只用雲端）。
 */
export async function planForUi(): Promise<{
  hardware: HardwareInfo;
  network: Awaited<ReturnType<typeof runNetworkProbe>>;
  options: PlanOption[];
  registry: Record<ModuleId, ModuleState>;
}> {
  const hardware = await detectHardware();
  const recommended = planLocalAI(hardware);
  const network = await runNetworkProbe();
  const options: PlanOption[] = [];
  if (recommended.tier !== 'none') {
    options.push({ id: 'recommended', label: '推薦方案', plan: recommended });
    if (recommended.tier !== 'light') {
      const l = MODEL_TABLE.light;
      options.push({
        id: 'light',
        label: '較輕方案',
        plan: {
          tier: 'light', judgmentModel: l.judgment, chatModel: l.judgment, installBoth: false,
          requiredDiskGB: l.diskGB, reasons: ['較輕方案：下載較小、回應較快，但精讀品質可能較低'],
        },
      });
    }
  }
  options.push({
    id: 'skip',
    label: '不安裝（只用雲端）',
    plan: { tier: 'none', judgmentModel: null, chatModel: null, installBoth: false, requiredDiskGB: 0, reasons: ['不安裝本地 AI，所有 AI 功能使用雲端'] },
  });
  return { hardware, network, options, registry: await readModuleStatus() };
}

// ---------------------------------------------------------------------------
// AI 引擎模組
// ---------------------------------------------------------------------------
function enginePaths() {
  const dir = path.join(modulesDir(), 'ai-engine');
  return { dir, setup: path.join(dir, 'OllamaSetup.exe') };
}

/** 以 PowerShell 驗證安裝檔的數位簽章（唯讀）。 */
async function verifyInstallerSignature(file: string): Promise<void> {
  const script = `Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}' | Select-Object @{n='Status';e={$_.Status.ToString()}}, @{n='Subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`;
  const report = parseSignatureJson(await runPowerShell(script));
  const res = isTrustedSignature(report, OLLAMA_PUBLISHER);
  if (!res.ok) throw new Error(`簽章驗證失敗（SIGNATURE_INVALID）：${res.reason}`);
}

function runInstaller(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, ['/VERYSILENT', '/NORESTART'], { windowsHide: true });
    child.on('error', (e) => reject(new Error(`安裝程式無法執行：${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Ollama 安裝程式結束代碼 ${code}（INSTALLER_FAILED）`))));
  });
}

function startOllamaService(): void {
  // 以分離的程序啟動服務；找不到執行檔時會在 error 事件中被上層的健康檢查視為 SERVICE_DOWN。
  const child = spawn('ollama', ['serve'], { windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

/** 安裝 AI 引擎模組：依序執行各階段，每階段都會回報事件；任一階段失敗即停止並寫入模組狀態。 */
export async function installAiEngineModule(
  plan: LocalPlan,
  send: (ev: StageEvent) => void,
): Promise<ModuleState> {
  if (plan.tier === 'none' || !plan.judgmentModel || !plan.chatModel) throw new Error('所選方案為不安裝，沒有需要安裝的模型');
  const base = engineBaseUrl();
  const models = [...new Set([plan.judgmentModel, plan.chatModel])];
  const judgmentBackend = new OllamaBackend({ judgment: plan.judgmentModel, chat: plan.chatModel }, { baseUrl: base });
  const ev = (stage: string, status: StageEvent['status'], extra: Partial<StageEvent> = {}) =>
    send({ module: 'ai-engine', stage, status, ...extra });
  let stage = 'checkSystem';
  await setModule('ai-engine', { status: 'installing', lastError: null, failedStage: null });
  try {
    await ev(stage, 'start');
    const hw = await detectHardware();
    await ev(stage, 'done', { detail: `記憶體 ${hw.ramGB} GB，磁碟可用 ${hw.freeDiskGB} GB` });

    stage = 'checkNetwork';
    await ev(stage, 'start');
    const net = await runNetworkProbe();
    if (!net.ready) throw new Error(`網路檢查未通過：${net.messages.join('；')}`);
    await ev(stage, 'done');

    stage = 'installEngine';
    await ev(stage, 'start');
    const existing = await getOllamaVersion({ baseUrl: base });
    if (!existing) {
      const { setup } = enginePaths();
      await withRetry(
        () => downloadWithResume({
          url: OLLAMA_SETUP_URL, file: setup,
          onProgress: (d, t) => ev(stage, 'progress', { completed: d, total: t ?? undefined, detail: '下載安裝檔' }),
        }),
        { attempts: 3, baseDelayMs: 2000, onRetry: (n, delay) => ev(stage, 'retry', { detail: `第 ${n} 次重試（${delay / 1000} 秒後）` }) },
      );
      await verifyInstallerSignature(setup);
      await runInstaller(setup);
    }
    await ev(stage, 'done', { detail: existing ? `已安裝，版本 ${existing}` : '安裝完成' });

    stage = 'verifyEngine';
    await ev(stage, 'start');
    const health = await ensureEngineRunning({
      baseUrl: base,
      startService: process.env.JUDGE_OLLAMA_URL ? undefined : startOllamaService,
      maxWaitMs: 60_000,
      maxStartAttempts: 2,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    if (!health.ok) throw new Error('本地服務沒有回應（SERVICE_DOWN）');
    await ev(stage, 'done', { detail: `服務版本 ${health.version}` });

    stage = 'pullModels';
    for (const m of models) {
      await ev(stage, 'start', { detail: m });
      if (await hasModel(m, { baseUrl: base })) {
        await ev(stage, 'done', { detail: `${m} 已存在` });
        continue;
      }
      await withRetry(
        () => pullModel(m, (p) => ev(stage, 'progress', { detail: m, completed: p.completed, total: p.total }), { baseUrl: base }),
        { attempts: 3, baseDelayMs: 2000, onRetry: (n, delay) => ev(stage, 'retry', { detail: `${m} 第 ${n} 次重試（${delay / 1000} 秒後）` }) },
      );
      await ev(stage, 'done', { detail: m });
    }

    stage = 'smokeTest';
    await ev(stage, 'start');
    for (const m of models) {
      const task = m === plan.judgmentModel ? 'judgment' : 'chat';
      const r = await judgmentBackend.run<{ text: string }>(task, { prompt: '請只回答：OK' });
      if (!r.text) throw new Error(`模型 ${m} 測試回應為空`);
    }
    await ev(stage, 'done');

    stage = 'register';
    await ev(stage, 'start');
    const state = await setModule('ai-engine', {
      status: 'ready', installedVersion: AI_ENGINE_MODULE_VERSION, lastError: null, failedStage: null,
    });
    await ev(stage, 'done');
    // 記錄所選方案，供 requireAi 使用。
    await writePlanRecord(plan);
    return state;
  } catch (e: any) {
    const c = classifyError(e);
    const rp = repairPlan(c.code);
    const msg = `${c.code}：${e?.message ?? String(e)}`;
    await setModule('ai-engine', { status: 'failed', lastError: `${msg}｜${rp.userSteps.join(' ')}`, failedStage: stage });
    await ev(stage, 'failed', { detail: msg });
    await appendFailure('ai-engine', stage, c, e);
    return (await readModuleStatus())['ai-engine'];
  }
}

/** 使用者選「不安裝」：只標記 AI 引擎為 disabled，爬取模組狀態不變。 */
export async function setSkipAi(): Promise<ModuleState> {
  return setModule('ai-engine', { status: 'disabled', lastError: null, failedStage: null });
}

async function writePlanRecord(plan: LocalPlan): Promise<void> {
  const f = path.join(modulesDir(), 'ai-engine', 'plan.json');
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(plan, null, 2), 'utf8');
}

async function readPlanRecord(): Promise<LocalPlan | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(modulesDir(), 'ai-engine', 'plan.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** 執行單一修復動作（由畫面按鈕觸發）。 */
export async function runRepair(action: RepairActionId, send: (ev: StageEvent) => void): Promise<ModuleState> {
  const base = engineBaseUrl();
  if (action === 'restart-service') {
    const h = await ensureEngineRunning({ baseUrl: base, startService: process.env.JUDGE_OLLAMA_URL ? undefined : startOllamaService, maxWaitMs: 60_000, maxStartAttempts: 2, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    if (!h.ok) throw new Error('重新啟動後服務仍沒有回應（SERVICE_DOWN）');
    return setModule('ai-engine', { status: 'ready', lastError: null, failedStage: null });
  }
  if (action === 'redownload-installer') {
    const { setup } = enginePaths();
    await fs.rm(setup, { force: true });
    await fs.rm(`${setup}.part`, { force: true });
  }
  if (action === 'reregister') {
    const st = (await readModuleStatus())['ai-engine'];
    if (st.status !== 'failed' && st.status !== 'ready') throw new Error('尚未安裝，無法重新註冊');
    const plan = await readPlanRecord();
    if (!plan) throw new Error('找不到安裝方案紀錄，請重新安裝');
    const h = await ensureEngineRunning({ baseUrl: base, maxWaitMs: 5000, maxStartAttempts: 1, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    if (!h.ok) throw new Error('服務沒有回應（SERVICE_DOWN）');
    return setModule('ai-engine', { status: 'ready', lastError: null, failedStage: null });
  }
  // retry / reinstall-engine / repull-models / redownload-installer：以已保存的方案重跑安裝（已完成的步驟會自動略過或續傳）。
  const plan = await readPlanRecord();
  if (!plan) throw new Error('找不到安裝方案紀錄，請重新檢查並安裝');
  return installAiEngineModule(plan, send);
}

// ---------------------------------------------------------------------------
// 爬取模組
// ---------------------------------------------------------------------------
export async function installCrawlerModuleForApp(send: (ev: StageEvent) => void): Promise<ModuleState> {
  await setModule('crawler', { status: 'installing', lastError: null, failedStage: null });
  const res = await installCrawlerModule({
    probe: () => runNetworkProbe(),
    smokeFetch: () => searchJudgments('損害賠償', { maxItems: 1 }),
    register: () => undefined,
  });
  for (const s of res.completed) send({ module: 'crawler', stage: s, status: 'done' });
  if (!res.ok && res.failedAt) {
    send({ module: 'crawler', stage: res.failedAt, status: 'failed', detail: res.error });
    const c = classifyError(new Error(res.error ?? ''));
    await appendFailure('crawler', res.failedAt, c, new Error(res.error ?? ''));
    return setModule('crawler', { status: 'failed', lastError: `${c.code}：${res.error}`, failedStage: res.failedAt });
  }
  return setModule('crawler', { status: 'ready', installedVersion: CRAWLER_MODULE_VERSION, lastError: null, failedStage: null });
}

// ---------------------------------------------------------------------------
// 執行期：供 requireAi 使用
// ---------------------------------------------------------------------------
/** 若 AI 引擎模組為 ready，回傳本地後端（Ollama）；否則 null。 */
export async function localBackendIfReady(): Promise<RouterBackend | null> {
  const st = (await readModuleStatus())['ai-engine'];
  const plan = await readPlanRecord();
  if (st.status !== 'ready' || !plan?.judgmentModel || !plan.chatModel) return null;
  const ollama = new OllamaBackend({ judgment: plan.judgmentModel, chat: plan.chatModel }, { baseUrl: engineBaseUrl() });
  return {
    kind: 'local',
    run: async <T>(task: 'judgment' | 'chat' | 'crawl', payload: unknown) => {
      const r = await ollama.run<{ text: string }>(task, payload);
      return r.text as unknown as T;
    },
  };
}

async function appendFailure(module: ModuleId, stage: string, c: ClassifiedError, e: unknown): Promise<void> {
  const f = path.join(modulesDir(), 'failures.json');
  let list: unknown[] = [];
  try { list = JSON.parse(await fs.readFile(f, 'utf8')); } catch { /* 首次寫入 */ }
  const report = buildFailureReport({
    appVersion: app.getVersion(), rulesVersion: LOCAL_RULES_VERSION, stage: `${module}/${stage}`,
    tier: 'n/a', osVersion: `${os.type()} ${os.release()}`, message: `${c.code} ${(e as Error)?.message ?? ''}`,
  });
  list.push({ at: new Date().toISOString(), ...report });
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(list.slice(-50), null, 2), 'utf8');
}
