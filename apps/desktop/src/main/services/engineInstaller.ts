// 引擎檔案：下載 Ollama zip（可續傳、SHA-256 校驗）、安全解壓到 engine/bin、找出 ollama.exe。
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import {
  withRetry, downloadFromFirstAvailable, ollamaAssetFor, isSafeZipEntry, sha256File, type NativeArch,
} from '@judge/core';
import { engineRoot } from '../data/local/localPaths';
import { readEngine } from '../data/local/engineStore';
import { fetchLatestAsset } from '../data/cloud/releaseSource';
import type { StageEvent } from './jobBus';

// adm-zip 是既有依賴，以 CommonJS 方式載入。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip: new (file: string) => { getEntries(): { entryName: string }[]; extractAllTo(dir: string, overwrite: boolean): void } = require('adm-zip');

export async function findExe(dir: string): Promise<string | null> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === 'ollama.exe') return full;
    if (e.isDirectory()) {
      const inner = await findExe(full);
      if (inner) return inner;
    }
  }
  return null;
}

/** 下載 zip（可續傳、SHA-256 校驗）並解壓到 engine/bin。回傳 ollama.exe 路徑與 zip 摘要。 */
export async function installEngineFiles(arch: NativeArch, send: (ev: StageEvent) => void): Promise<{ exe: string; zipSha256: string; asset: string }> {
  const assetName = ollamaAssetFor(arch);
  if (!assetName) throw new Error(`不支援的 CPU 架構 ${arch}，無法安裝本地引擎`);
  const asset = await fetchLatestAsset(assetName);
  const zipFile = path.join(engineRoot(), 'download', assetName);

  // 先檢查本機是否已有相同版本（同一個 SHA-256）且完整的引擎：有就直接沿用，不重新下載或解壓。
  const prev = await readEngine();
  if (prev.zipSha256 === asset.sha256 && prev.exePath && fsSync.existsSync(prev.exePath) && prev.exeSha256) {
    if ((await sha256File(prev.exePath)) === prev.exeSha256) {
      send({ module: 'ai-engine', stage: 'installEngine', status: 'progress', detail: '本機已有相同版本的引擎，略過下載與解壓' });
      return { exe: prev.exePath, zipSha256: asset.sha256, asset: assetName };
    }
  }

  // 下載：若下載資料夾內已有相同摘要的 zip，直接使用，不再從網路下載。
  const haveZip = fsSync.existsSync(zipFile) && (await sha256File(zipFile)) === asset.sha256;
  if (!haveZip) {
    await withRetry(
      () => downloadFromFirstAvailable({
        urls: asset.urls, file: zipFile, expectedSha256: asset.sha256,
        onProgress: (d, t) => send({ module: 'ai-engine', stage: 'installEngine', status: 'progress', detail: '下載引擎', completed: d, total: t ?? undefined }),
      }),
      { attempts: 3, baseDelayMs: 2000, onRetry: (n, delay) => send({ module: 'ai-engine', stage: 'installEngine', status: 'retry', detail: `第 ${n} 次重試（${delay / 1000} 秒後）` }) },
    );
  }
  const bin = path.join(engineRoot(), 'bin');
  await fs.rm(bin, { recursive: true, force: true });
  await fs.mkdir(bin, { recursive: true });
  const zip = new AdmZip(zipFile);
  for (const e of zip.getEntries()) {
    if (!isSafeZipEntry(e.entryName)) throw new Error(`引擎壓縮檔含不安全的路徑：${e.entryName}`);
  }
  zip.extractAllTo(bin, true);
  const exe = await findExe(bin);
  if (!exe) throw new Error('解壓後找不到 ollama.exe（INSTALLER_FAILED）');
  return { exe, zipSha256: asset.sha256, asset: assetName };
}
