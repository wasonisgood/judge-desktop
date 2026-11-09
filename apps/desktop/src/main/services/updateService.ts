// 模組更新（目錄比對、只下載變動、驗證失敗回滾）。
// 模組目錄（雲端）與本機模組（本地）各自獨立：目錄版本不必與應用程式版本或另一端同步。
import * as path from 'node:path';
import {
  planCatalogUpdate, readInstalledModule, applyModuleUpdate, discardPrevious, validateRules,
  type ModuleCatalog, type ModuleId, type ModulePlan,
} from '@judge/core';
import { MODULE_IDS, moduleCurrent } from '../data/local/localPaths';
import { readJson } from '../data/local/jsonFile';
import { catalogUrl, fetchCatalog } from '../data/cloud/releaseSource';
import { setModule, ensureBundledModules } from './moduleState';
import type { StageEvent } from './jobBus';

export interface UpdateCheck {
  ok: boolean;
  error: string | null;
  catalogVersion: number | null;
  plans: ModulePlan[];
  appUpdateNeeded: boolean;
  catalogUrl: string;
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
