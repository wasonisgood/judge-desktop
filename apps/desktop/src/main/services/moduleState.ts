// 模組狀態服務：更新單一模組的登錄狀態並即時通知畫面；模組檔案隨應用程式版本同步（增量）。
// 模組不提供使用者獨立下載：模組檔案內建於應用程式，應用程式升級時在啟動時比對雜湊，只複製有變動的檔案。
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { sha256File, planBundleSync, type ModuleId, type ModuleState } from '@judge/core';
import { MODULE_IDS, moduleCurrent, bundledModuleDir } from '../data/local/localPaths';
import { readJson, writeJson } from '../data/local/jsonFile';
import { loadRegistry, saveRegistry } from '../data/local/registryStore';
import { broadcast } from './jobBus';

/** 更新單一模組的狀態；其他模組不受影響。 */
export async function setModule(id: ModuleId, patch: Partial<ModuleState>): Promise<ModuleState> {
  const reg = await loadRegistry();
  const next = reg.set(id, patch);
  await saveRegistry(reg);
  broadcast('local:changed', { id, state: next }); // 設定頁與精靈即時更新
  return next;
}

interface InstalledManifest {
  moduleId?: ModuleId;
  version: string | null;
  files: Record<string, string>;
}

async function bundledFiles(src: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await fs.readdir(src)) {
    if (name === 'module.json') continue;
    out[name] = await sha256File(path.join(src, name));
  }
  return out;
}

/**
 * 同步模組檔案與應用程式內建版本（增量）：
 * - 版本與檔案雜湊都相同 → 不動作；
 * - 首次安裝 → 複製全部檔案並設為「尚未安裝」狀態（由安裝精靈註冊）；
 * - 版本或檔案不同 → 只複製雜湊不同的檔案，並刪除內建已不存在的檔案。
 */
export async function syncBundledModules(): Promise<void> {
  for (const id of MODULE_IDS) {
    const cur = moduleCurrent(id);
    const src = bundledModuleDir(id);
    const meta = await readJson<{ version: string }>(path.join(src, 'module.json'), { version: '0.0.0' });
    const want = await bundledFiles(src);
    const manifestFile = path.join(cur, 'manifest.json');
    const hasRecord = fsSync.existsSync(manifestFile);
    const installed = hasRecord ? await readJson<InstalledManifest>(manifestFile, { version: null, files: {} }) : null;
    // 增量計畫由 core 的純函式決定（有測試）：只複製變動的檔案，刪除內建已移除的檔案。
    const plan = planBundleSync(meta.version, want, installed);
    if (plan.upToDate) continue;
    const firstTime = plan.firstInstall;

    await fs.mkdir(cur, { recursive: true });
    for (const name of plan.copy) await fs.copyFile(path.join(src, name), path.join(cur, name));
    for (const name of plan.remove) await fs.rm(path.join(cur, name), { force: true });
    await writeJson(manifestFile, { moduleId: id, version: meta.version, files: want });
    await setModule(id, firstTime
      ? { installedVersion: meta.version, status: 'not-installed' }
      : { installedVersion: meta.version });
  }
}
