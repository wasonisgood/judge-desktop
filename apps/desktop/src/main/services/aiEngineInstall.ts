// AI 引擎模組安裝精靈（作為主程序的背景任務；畫面只是觀看者）：
// 系統檢查 → 網路 → 決定引擎 → 安裝引擎 → 啟動服務 → 驗證 → 下載模型 → 煙霧測試 → 註冊。
import * as path from 'node:path';
import * as fsSync from 'node:fs';
import {
  runNetworkProbe, getOllamaVersion, pullModel, OllamaBackend, ensureEngineRunning, withRetry, classifyError, repairPlan,
  decideExistingEngine, modelsToPull, compareVersions, sha256File,
  type HardwareInfo, type LocalPlan, type ModuleState, type NativeArch,
} from '@judge/core';
import { AI_ENGINE_MODULE_ID, EXTERNAL_BASE, OWN_BASE, engineRoot, moduleCurrent } from '../data/local/localPaths';
import { readJson } from '../data/local/jsonFile';
import { EMPTY_ENGINE, readEngine, writeEngine, writePlan, writeHardwareCache } from '../data/local/engineStore';
import { engineBaseOverride, listModels, startOwnService } from '../data/local/ollamaService';
import { activeProbeTargets, loadActiveRules } from '../data/local/moduleFiles';
import { detectHardware, detectNativeArch } from '../data/local/system';
import { appendFailure } from '../data/local/failureLog';
import { emitStage, runAsJob, type StageEvent } from './jobBus';
import { signalOfRunning } from './jobRegistry';
import { JobCancelledError } from '@judge/core';
import { setModule, syncBundledModules } from './moduleState';
import { installEngineFiles } from './engineInstaller';
import { checkPrerequisites } from './prerequisites';

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
  await syncBundledModules();
  const { rules } = await loadActiveRules();
  const required = [...new Set([plan.judgmentModel, plan.chatModel])];
  const ev = (stage: string, status: StageEvent['status'], extra: Partial<StageEvent> = {}) => {
    // 階段開始前檢查取消（v3.6.0）：取消後不再進入下一階段。
    if (status === 'start' && signalOfRunning(['install', 'repair'])?.aborted) throw new JobCancelledError();
    send({ module: AI_ENGINE_MODULE_ID, stage, status, ...extra });
  };
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
      await writeHardwareCache(hw, arch);
    } catch (e: any) {
      const cached = await readJson<{ hardware: HardwareInfo; nativeArch: NativeArch; at: string } | null>(path.join(engineRoot(), 'hardware.json'), null);
      if (!cached) throw new Error(`系統偵測失敗且沒有先前的紀錄（${e?.message ?? e}）`);
      hw = cached.hardware;
      arch = cached.nativeArch;
      source = `先前偵測（${cached.at.slice(0, 16).replace('T', ' ')}）`;
    }
    await ev(stage, 'done', { detail: `記憶體 ${hw.ramGB} GB，磁碟可用 ${hw.freeDiskGB} GB，CPU ${arch}（${source}）` });

    // 前置工具（macOS、Linux）：缺少 tar 或 df 時在這裡停止，並給出發行版對應的安裝指令。
    const pre = await checkPrerequisites();
    if (!pre.ok) throw new Error(pre.error);

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
      // AMD 獨立顯卡且顯存足夠時才使用 ROCm 版本，與方案的加速判斷一致。
      const accelVendor = hw.gpuVendor === 'amd' && hw.vramGB >= rules.dualModelMinVramGB ? 'amd' : 'none';
      const installed = await installEngineFiles(arch, (e) => send({ ...e, module: AI_ENGINE_MODULE_ID }), accelVendor);
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
        () => pullModel(m, (p) => ev(stage, 'progress', { detail: m, completed: p.completed, total: p.total }), { baseUrl: base, signal: signalOfRunning(['install', 'repair']) }),
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
    if (e instanceof JobCancelledError) {
      // 取消不是失敗：已下載的部分檔保留，重新安裝時可接續。
      const cancelled = await setModule(AI_ENGINE_MODULE_ID, { status: 'failed', lastError: '已取消安裝；已下載的部分會保留，重新安裝時可接續。', failedStage: stage });
      ev(stage, 'failed', { detail: '已取消' });
      return cancelled;
    }
    const c = classifyError(e);
    const rp = repairPlan(c.code);
    const msg = `${c.code}：${e?.message ?? String(e)}`;
    const st = await setModule(AI_ENGINE_MODULE_ID, { status: 'failed', lastError: `${msg}｜${rp.userSteps.join(' ')}`, failedStage: stage });
    ev(stage, 'failed', { detail: msg });
    await appendFailure(AI_ENGINE_MODULE_ID, stage, c.code, e);
    return st;
  }
}

