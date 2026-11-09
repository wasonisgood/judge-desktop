// 本地資料層：模組登錄（registry.json）。每個模組的狀態各自保存。
import * as path from 'node:path';
import { ModuleRegistry, type ModuleId, type ModuleState } from '@judge/core';
import { modulesRoot } from './localPaths';
import { readJson, writeJson } from './jsonFile';

export async function loadRegistry(): Promise<ModuleRegistry> {
  return new ModuleRegistry(await readJson(path.join(modulesRoot(), 'registry.json'), {} as any));
}

export async function saveRegistry(reg: ModuleRegistry): Promise<void> {
  await writeJson(path.join(modulesRoot(), 'registry.json'), reg.toJSON());
}

export async function readModuleStatus(): Promise<Record<ModuleId, ModuleState>> {
  return (await loadRegistry()).toJSON();
}
