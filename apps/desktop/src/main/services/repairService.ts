// 修復服務：每個修復動作都以任務方式執行，進度廣播給畫面。
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as fsSync from 'node:fs';
import {
  ensureEngineRunning, getOllamaVersion, pullModel, withRetry, modelsToPull, ollamaAssetFor,
  type ModuleState, type RepairActionId,
} from '@judge/core';
import { AI_ENGINE_MODULE_ID, OWN_BASE, engineRoot } from '../data/local/localPaths';
import { readEngine, readPlan } from '../data/local/engineStore';
import { engineBaseOverride, listModels, startOwnService } from '../data/local/ollamaService';
import { setModule } from './moduleState';
import { runAsJob, emitStage, type StageEvent } from './jobBus';
import { signalOfRunning } from './jobRegistry';
import { installAiEngineModule } from './aiEngineInstall';
import { diagnose } from './diagnosticsService';

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
      await withRetry(() => pullModel(m, (p) => send({ module: AI_ENGINE_MODULE_ID, stage: 'pullModels', status: 'progress', detail: m, completed: p.completed, total: p.total }), { baseUrl: base, signal: signalOfRunning(['install', 'repair']) }), { attempts: 3, baseDelayMs: 2000, signal: signalOfRunning(['install', 'repair']) });
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
