// 方案服務（第一階段）：檢查與方案選項。只讀取與計算，不安裝任何東西。方案一律由主程序重新計算。
import {
  planLocalAI, runNetworkProbe, type HardwareInfo, type LocalPlan, type ModuleId, type ModuleState, type NativeArch,
} from '@judge/core';
import { AI_ENGINE_MODULE_ID } from '../data/local/localPaths';
import { readModuleStatus } from '../data/local/registryStore';
import { loadActiveRules, activeProbeTargets } from '../data/local/moduleFiles';
import { detectHardware, detectNativeArch } from '../data/local/system';
import { writeHardwareCache } from '../data/local/engineStore';
import { setModule, syncBundledModules } from './moduleState';

export type PlanChoice = 'recommended' | 'light' | 'skip';

export interface PlanOption {
  id: PlanChoice;
  label: string;
  plan: LocalPlan;
}

export async function planForUi(): Promise<{
  hardware: HardwareInfo;
  nativeArch: NativeArch;
  network: Awaited<ReturnType<typeof runNetworkProbe>>;
  options: PlanOption[];
  registry: Record<ModuleId, ModuleState>;
  rulesSource: 'module' | 'builtin';
}> {
  await syncBundledModules();
  const { rules, source } = await loadActiveRules();
  const hardware = await detectHardware();
  const nativeArch = await detectNativeArch();
  await writeHardwareCache(hardware, nativeArch);
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

