// 排除問題：收集事實（唯讀）→ 核心的診斷規則判讀 → 可匯出報告。
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { app } from 'electron';
import {
  getOllamaVersion, runNetworkProbe, OllamaBackend, runDiagnostics, summarize, formatDiagnosticReport,
  sha256File, type DiagFacts, type DiagSummary,
} from '@judge/core';
import { AI_ENGINE_MODULE_ID, OWN_BASE, userData } from '../data/local/localPaths';
import { readEngine, readPlan } from '../data/local/engineStore';
import { readModuleStatus } from '../data/local/registryStore';
import { activeProbeTargets } from '../data/local/moduleFiles';
import { detectHardware, detectNativeArch, authenticodeStatus } from '../data/local/system';
import { engineBaseOverride, listModels } from '../data/local/ollamaService';
import { readFailures } from '../data/local/failureLog';

async function collectFacts(): Promise<DiagFacts> {
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
  const failures = await readFailures();
  const last = failures.at(-1);

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
