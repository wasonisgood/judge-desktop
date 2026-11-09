// 模組狀態服務：更新單一模組的登錄狀態並即時通知畫面；首次使用時把內建模組複製到 current。
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { sha256File, type ModuleId, type ModuleState } from '@judge/core';
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

/** 模組檔案：首次使用時從應用程式內建複製到 current；之後只由「模組更新」改動。 */
export async function ensureBundledModules(): Promise<void> {
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
