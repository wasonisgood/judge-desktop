// 套用模組更新（安全換入）：
// 1. 在 <模組>.staging 組好新版本：本機已有且雜湊相同的檔案直接複製；其餘用可續傳下載並校驗 SHA-256。
// 2. 全部成功才把目前版本搬到 <模組>.previous，再把 staging 換成目前版本。
// 3. 換入後執行 verify（例如確認規則表可解析）；失敗就自動回滾到 previous。
// 任何一步失敗，目前版本都不會是半新半舊的狀態。
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { downloadWithResume, sha256File } from '../engine/download';
import type { CatalogModule, InstalledModule } from './catalog';
import type { ModuleId } from './registry';

export interface ApplyOptions {
  moduleId: ModuleId;
  /** 模組目前所在資料夾（例如 userData/modules/ai-engine/current）。 */
  moduleDir: string;
  target: CatalogModule;
  fetchImpl?: typeof fetch;
  /** 換入後的驗證；回傳錯誤訊息則回滾，回傳 null 代表通過。 */
  verify?: (dir: string) => Promise<string | null> | string | null;
  onProgress?: (msg: string) => void;
}

export interface ApplyResult {
  ok: boolean;
  moduleId: ModuleId;
  version: string;
  downloaded: string[];
  reused: string[];
  rolledBack: boolean;
  error?: string;
}

/** 讀取目前已安裝的模組（版本來自 manifest.json，檔案雜湊即時計算）。 */
export async function readInstalledModule(moduleDir: string): Promise<InstalledModule> {
  let version: string | null = null;
  try {
    version = JSON.parse(await fsp.readFile(path.join(moduleDir, 'manifest.json'), 'utf8')).version ?? null;
  } catch {
    version = null;
  }
  const files: Record<string, string> = {};
  if (fs.existsSync(moduleDir)) {
    for (const rel of await listFiles(moduleDir)) {
      if (rel === 'manifest.json') continue;
      files[rel] = await sha256File(path.join(moduleDir, rel));
    }
  }
  return { version: files && Object.keys(files).length ? version : null, files };
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

export async function applyModuleUpdate(opts: ApplyOptions): Promise<ApplyResult> {
  const { moduleDir, target } = opts;
  const staging = `${moduleDir}.staging`;
  const previous = `${moduleDir}.previous`;
  const downloaded: string[] = [];
  const reused: string[] = [];
  const fail = (error: string, rolledBack = false): ApplyResult => ({
    ok: false, moduleId: opts.moduleId, version: target.version, downloaded, reused, rolledBack, error,
  });

  const current = fs.existsSync(moduleDir) ? await readInstalledModule(moduleDir) : { version: null, files: {} };
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });

  try {
    for (const [rel, f] of Object.entries(target.files)) {
      const dest = path.join(staging, ...rel.split('/'));
      if (current.files[rel] === f.sha256) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(path.join(moduleDir, ...rel.split('/')), dest);
        reused.push(rel);
        continue;
      }
      opts.onProgress?.(`下載 ${rel}`);
      await downloadWithResume({
        url: f.url, file: dest, expectedSha256: f.sha256, fetchImpl: opts.fetchImpl,
      });
      downloaded.push(rel);
    }
  } catch (e: any) {
    await fsp.rm(staging, { recursive: true, force: true });
    return fail(`下載或校驗失敗：${e?.message ?? String(e)}`);
  }

  // 換入：目前 → previous；staging → 目前。
  await fsp.rm(previous, { recursive: true, force: true });
  if (fs.existsSync(moduleDir)) await fsp.rename(moduleDir, previous);
  await fsp.rename(staging, moduleDir);
  await fsp.writeFile(path.join(moduleDir, 'manifest.json'), JSON.stringify({ moduleId: opts.moduleId, version: target.version, files: Object.fromEntries(Object.entries(target.files).map(([p, f]) => [p, f.sha256])) }, null, 2), 'utf8');

  const err = await opts.verify?.(moduleDir);
  if (err) {
    await rollbackModule(moduleDir);
    return fail(`驗證失敗，已回滾到先前版本：${err}`, true);
  }
  return { ok: true, moduleId: opts.moduleId, version: target.version, downloaded, reused, rolledBack: false };
}

/** 回滾：把 previous 還原為目前版本，並移除失敗的新版本。 */
export async function rollbackModule(moduleDir: string): Promise<boolean> {
  const previous = `${moduleDir}.previous`;
  if (!fs.existsSync(previous)) return false;
  await fsp.rm(moduleDir, { recursive: true, force: true });
  await fsp.rename(previous, moduleDir);
  return true;
}

/** 確認更新成功後，移除 previous 備份。 */
export async function discardPrevious(moduleDir: string): Promise<void> {
  await fsp.rm(`${moduleDir}.previous`, { recursive: true, force: true });
}
