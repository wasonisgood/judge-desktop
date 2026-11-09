// 爬取模組安裝：探測網路 → 冒煙測試（實際查詢一筆）→ 註冊。失敗會記錄並可在排除問題頁查看。
import * as path from 'node:path';
import {
  installCrawlerModule, runNetworkProbe, searchJudgments, classifyError, type ModuleState,
} from '@judge/core';
import { moduleCurrent } from '../data/local/localPaths';
import { readJson } from '../data/local/jsonFile';
import { appendFailure } from '../data/local/failureLog';
import { activeProbeTargets } from '../data/local/moduleFiles';
import { setModule, ensureBundledModules } from './moduleState';
import type { StageEvent } from './jobBus';

export async function installCrawlerModuleForApp(send: (ev: StageEvent) => void): Promise<ModuleState> {
  await ensureBundledModules();
  await setModule('crawler', { status: 'installing', lastError: null, failedStage: null });
  const targets = await activeProbeTargets();
  const res = await installCrawlerModule({
    probe: () => runNetworkProbe({ targets }),
    smokeFetch: () => searchJudgments('損害賠償', { maxItems: 1 }),
    register: () => undefined,
  });
  for (const s of res.completed) send({ module: 'crawler', stage: s, status: 'done' });
  if (!res.ok && res.failedAt) {
    send({ module: 'crawler', stage: res.failedAt, status: 'failed', detail: res.error });
    const c = classifyError(new Error(res.error ?? ''));
    await appendFailure('crawler', res.failedAt, c.code, new Error(res.error ?? ''));
    return setModule('crawler', { status: 'failed', lastError: `${c.code}：${res.error}`, failedStage: res.failedAt });
  }
  const version = (await readJson<{ version: string }>(path.join(moduleCurrent('crawler'), 'manifest.json'), { version: null as any })).version;
  return setModule('crawler', { status: 'ready', installedVersion: version, lastError: null, failedStage: null });
}
