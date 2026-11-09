// 本地資料層：模組檔案的讀取（目前生效的分級規則、網路探測目標）。模組檔案只由「模組更新」改動。
import * as path from 'node:path';
import { validateRules, BUILTIN_RULES, DEFAULT_TARGETS, type EngineRules, type ProbeTarget } from '@judge/core';
import { moduleCurrent, AI_ENGINE_MODULE_ID } from './localPaths';
import { readJson } from './jsonFile';

/** 目前生效的分級規則：模組 current/rules.json 有效就用它，否則用內建。 */
export async function loadActiveRules(): Promise<{ rules: EngineRules; source: 'module' | 'builtin'; error: string | null }> {
  const raw = await readJson<unknown>(path.join(moduleCurrent(AI_ENGINE_MODULE_ID), 'rules.json'), null);
  if (!raw) return { rules: BUILTIN_RULES, source: 'builtin', error: null };
  const v = validateRules(raw);
  if (v.ok) return { rules: v.rules, source: 'module', error: null };
  return { rules: BUILTIN_RULES, source: 'builtin', error: v.error };
}

/** 網路探測目標：模組 current/endpoints.json 有效就用它，否則用內建。 */
export async function activeProbeTargets(): Promise<ProbeTarget[]> {
  const e = await readJson<{ probes?: ProbeTarget[] }>(path.join(moduleCurrent('crawler'), 'endpoints.json'), {});
  return Array.isArray(e.probes) && e.probes.length ? e.probes : DEFAULT_TARGETS;
}
