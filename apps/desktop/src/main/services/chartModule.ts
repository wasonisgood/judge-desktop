// 量化圖表模組的安裝、停用與移除（正式模組 ID：chart）。不需下載：模組內容內建於應用程式，
// 安裝只做內建描述檔檢查與圖表自我檢查，通過後登錄為 ready。停用與移除不影響其他模組與主程式。
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { installChartModule, type ModuleState } from '@judge/core';
import { bundledModuleDir, moduleCurrent } from '../data/local/localPaths';
import { readJson } from '../data/local/jsonFile';
import { loadRegistry } from '../data/local/registryStore';
import { appendFailure } from '../data/local/failureLog';
import { setModule } from './moduleState';
import { buildChartResult, sanitizeChartConfig } from './chartData';

async function bundleVersion(): Promise<string> {
  const meta = await readJson<{ version?: string }>(path.join(bundledModuleDir('chart'), 'module.json'), {});
  if (!meta.version) throw new Error('內建的量化圖表模組缺少版本資訊');
  return meta.version;
}

/** 用固定樣本實際組一張圖：裁判書數去重後，損害賠償應為 2 件。 */
export function chartSelfCheck(): void {
  const res = buildChartResult({
    sheet: {
      name: 'self-check',
      headers: ['ID', '案由'],
      rows: [{ ID: 'A', 案由: '損害賠償' }, { ID: 'B', 案由: '損害賠償' }, { ID: 'C', 案由: '租賃' }],
    },
    fileName: 'self-check.xlsx',
    inferredKinds: {},
    config: sanitizeChartConfig({ type: 'bar', unit: 'judgments', idColumn: 'ID', category: '案由' }),
  });
  if (res.judgmentCount !== 3 || !res.svg.startsWith('<svg') || !res.svg.includes('>2</text>')) {
    throw new Error('圖表自我檢查結果不符');
  }
}

export async function installChartModuleForApp(): Promise<ModuleState> {
  await setModule('chart', { status: 'installing', lastError: null, failedStage: null });
  let version = '';
  const res = await installChartModule({
    checkBundle: async () => { version = await bundleVersion(); },
    selfCheck: () => chartSelfCheck(),
    register: async () => {
      await setModule('chart', { status: 'ready', installedVersion: version, lastError: null, failedStage: null });
    },
  });
  if (res.ok) return (await loadRegistry()).get('chart');
  const stage = res.failedAt ?? 'checkBundle';
  await appendFailure('chart', stage, 'CHART_INSTALL', new Error(res.error ?? ''));
  return setModule('chart', { status: 'failed', lastError: `${stage}：${res.error}`, failedStage: stage });
}

/** 停用：保留安裝內容，功能隱藏；可再次安裝（即重新啟用）。 */
export async function disableChartModule(): Promise<ModuleState> {
  const cur = (await loadRegistry()).get('chart');
  if (cur.status === 'not-installed') return cur;
  return setModule('chart', { status: 'disabled', lastError: null, failedStage: null });
}

/** 移除：刪除模組資料夾並回到未安裝狀態。 */
export async function removeChartModule(): Promise<ModuleState> {
  await fs.rm(moduleCurrent('chart'), { recursive: true, force: true });
  return setModule('chart', { status: 'not-installed', installedVersion: null, lastError: null, failedStage: null });
}
