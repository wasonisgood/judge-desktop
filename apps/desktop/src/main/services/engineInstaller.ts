// 引擎檔案：下載 Ollama 官方發佈檔（可續傳、SHA-256 校驗）、安全解壓到 engine/bin、找出執行檔。
// Windows 用 zip（adm-zip）；macOS 用 tgz；Linux 用 tar.zst（純 JavaScript 解壓成 tar，不需要系統的 zstd）。
// tgz 與 tar 皆以系統的 tar 解開，解開前先列出內容檢查路徑。
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import {
  withRetry, downloadFromFirstAvailable, ollamaAssetFor, ollamaExeName, archiveKindFor, isSafeZipEntry, sha256File,
  type EnginePlatform, type NativeArch,
} from '@judge/core';
import { engineRoot } from '../data/local/localPaths';
import { readEngine } from '../data/local/engineStore';
import { fetchLatestAsset } from '../data/cloud/releaseSource';
import { runCommand } from '../data/local/system';
import { decompressZstdFile } from './zstdArchive';
import type { StageEvent } from './jobBus';

// adm-zip 是既有依賴，以 CommonJS 方式載入。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip: new (file: string) => { getEntries(): { entryName: string }[]; extractAllTo(dir: string, overwrite: boolean): void } = require('adm-zip');

const platform = (): EnginePlatform => process.platform as EnginePlatform;

export async function findExe(dir: string, exeName: string = ollamaExeName(platform())): Promise<string | null> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === exeName.toLowerCase()) return full;
    if (e.isDirectory()) {
      const inner = await findExe(full, exeName);
      if (inner) return inner;
    }
  }
  return null;
}

const EXTRACT_TIMEOUT_MS = 15 * 60_000;

/**
 * 解壓 tgz 或 tar.zst。tar.zst 先以純 JavaScript 串流解成 .tar（不需要系統安裝 zstd），
 * 再以系統的 tar 解開。兩者都先列出內容，任何不安全的路徑都會拒絕。
 */
async function extractWithTar(kind: 'tgz' | 'tar.zst', file: string, dest: string): Promise<void> {
  let tarFile = file;
  if (kind === 'tar.zst') {
    tarFile = file.replace(/\.zst$/, '');
    await decompressZstdFile(file, tarFile);
  }
  try {
    const listing = await runCommand('tar', ['-tf', tarFile], EXTRACT_TIMEOUT_MS);
    for (const name of listing.split(/\r?\n/)) {
      if (name && !isSafeZipEntry(name)) throw new Error(`引擎壓縮檔含不安全的路徑：${name}`);
    }
    await runCommand('tar', ['-xf', tarFile, '-C', dest], EXTRACT_TIMEOUT_MS);
  } finally {
    if (kind === 'tar.zst') await fs.rm(tarFile, { force: true });
  }
}

/** 解壓 zip（Windows）。 */
function extractZip(file: string, dest: string): void {
  const zip = new AdmZip(file);
  for (const e of zip.getEntries()) {
    if (!isSafeZipEntry(e.entryName)) throw new Error(`引擎壓縮檔含不安全的路徑：${e.entryName}`);
  }
  zip.extractAllTo(dest, true);
}

/**
 * 下載官方發佈檔（可續傳、SHA-256 校驗）並解壓到 engine/bin。回傳執行檔路徑與發佈檔摘要。
 * gpuVendor 為 'amd' 且顯存足以加速時，Linux 會改用 ROCm 版本（其餘情況傳 'none'）。
 */
export async function installEngineFiles(arch: NativeArch, send: (ev: StageEvent) => void, gpuVendor: string = 'none'): Promise<{ exe: string; zipSha256: string; asset: string }> {
  const assetName = ollamaAssetFor(arch, platform(), gpuVendor);
  if (!assetName) throw new Error(`不支援的 CPU 架構 ${arch}，無法安裝本地引擎`);
  const asset = await fetchLatestAsset(assetName);
  const archiveFile = path.join(engineRoot(), 'download', assetName);

  // 先檢查本機是否已有相同版本（同一個 SHA-256）且完整的引擎：有就直接沿用，不重新下載或解壓。
  const prev = await readEngine();
  if (prev.zipSha256 === asset.sha256 && prev.exePath && fsSync.existsSync(prev.exePath) && prev.exeSha256) {
    if ((await sha256File(prev.exePath)) === prev.exeSha256) {
      send({ module: 'ai-engine', stage: 'installEngine', status: 'progress', detail: '本機已有相同版本的引擎，略過下載與解壓' });
      return { exe: prev.exePath, zipSha256: asset.sha256, asset: assetName };
    }
  }

  // 下載：若下載資料夾內已有相同摘要的發佈檔，直接使用，不再從網路下載。
  const haveArchive = fsSync.existsSync(archiveFile) && (await sha256File(archiveFile)) === asset.sha256;
  if (!haveArchive) {
    await withRetry(
      () => downloadFromFirstAvailable({
        urls: asset.urls, file: archiveFile, expectedSha256: asset.sha256,
        onProgress: (d, t) => send({ module: 'ai-engine', stage: 'installEngine', status: 'progress', detail: '下載引擎', completed: d, total: t ?? undefined }),
      }),
      { attempts: 3, baseDelayMs: 2000, onRetry: (n, delay) => send({ module: 'ai-engine', stage: 'installEngine', status: 'retry', detail: `第 ${n} 次重試（${delay / 1000} 秒後）` }) },
    );
  }
  const bin = path.join(engineRoot(), 'bin');
  await fs.rm(bin, { recursive: true, force: true });
  await fs.mkdir(bin, { recursive: true });

  const kind = archiveKindFor(assetName);
  if (kind === 'zip') extractZip(archiveFile, bin);
  else await extractWithTar(kind, archiveFile, bin);

  const exeName = ollamaExeName(platform());
  const exe = await findExe(bin, exeName);
  if (!exe) throw new Error(`解壓後找不到 ${exeName}（INSTALLER_FAILED）`);
  if (platform() !== 'win32') await fs.chmod(exe, 0o755);
  return { exe, zipSha256: asset.sha256, asset: assetName };
}
