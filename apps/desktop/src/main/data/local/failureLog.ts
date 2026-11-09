// 本地資料層：失敗紀錄（failures.json，最多保留 50 筆）。內容已去敏，供排除問題與回報使用。
import * as os from 'node:os';
import * as path from 'node:path';
import { app } from 'electron';
import { buildFailureReport, LOCAL_RULES_VERSION, type ModuleId } from '@judge/core';
import { modulesRoot } from './localPaths';
import { readJson, writeJson } from './jsonFile';

export async function appendFailure(module: ModuleId, stage: string, code: string, e: unknown): Promise<void> {
  const f = path.join(modulesRoot(), 'failures.json');
  const list = await readJson<unknown[]>(f, []);
  const report = buildFailureReport({
    appVersion: app.getVersion(), rulesVersion: LOCAL_RULES_VERSION, stage: `${module}/${stage}`,
    tier: 'n/a', osVersion: `${os.type()} ${os.release()} ${os.arch()}`, message: `${code} ${(e as Error)?.message ?? ''}`,
  });
  list.push({ at: new Date().toISOString(), ...report });
  await writeJson(f, list.slice(-50));
}

export async function readFailures(): Promise<{ stage: string; code: string }[]> {
  return readJson<{ stage: string; code: string }[]>(path.join(modulesRoot(), 'failures.json'), []);
}
