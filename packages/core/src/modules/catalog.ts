// 模組目錄（catalog）：發版時產生的 modules.json，描述每個模組的最新版本與每個檔案的 SHA-256 與下載網址。
// 本機已安裝的模組則以 manifest.json（版本 + 各檔案雜湊）描述。兩者比對後，只下載變動的檔案。
import { planUpdate } from '../local/updateDiff';
import type { ModuleId } from './registry';

export interface CatalogFile {
  sha256: string;
  size: number;
  url: string;
}

export interface CatalogModule {
  version: string;
  /** 此版本需要新版應用程式（規則表以外的程式碼有變動）；為 true 時不能只更新模組。 */
  requiresAppUpdate: boolean;
  /** 模組內檔案路徑（相對於模組資料夾）→ 檔案資訊。 */
  files: Record<string, CatalogFile>;
}

export interface ModuleCatalog {
  catalogVersion: 1;
  modules: Partial<Record<ModuleId, CatalogModule>>;
}

export interface InstalledModule {
  version: string | null;
  /** 已安裝檔案：相對路徑 → SHA-256。 */
  files: Record<string, string>;
}

export interface ModulePlan {
  moduleId: ModuleId;
  fromVersion: string | null;
  toVersion: string;
  upToDate: boolean;
  requiresAppUpdate: boolean;
  /** 需要從網路下載的檔案（新增或內容改變）。 */
  download: string[];
  /** 本機已有且內容相同、不需下載的檔案。 */
  reuse: string[];
  remove: string[];
}

const SHA256 = /^[0-9a-f]{64}$/;

export function validateCatalog(x: unknown): { ok: true; catalog: ModuleCatalog } | { ok: false; error: string } {
  const c = x as ModuleCatalog;
  if (!c || typeof c !== 'object') return { ok: false, error: '目錄不是物件' };
  if (c.catalogVersion !== 1) return { ok: false, error: `不支援的 catalogVersion：${(c as any).catalogVersion}` };
  if (!c.modules || typeof c.modules !== 'object') return { ok: false, error: '缺少 modules' };
  for (const [id, m] of Object.entries(c.modules)) {
    if (!m || typeof m.version !== 'string' || !m.version) return { ok: false, error: `${id} 缺少版本` };
    if (typeof m.requiresAppUpdate !== 'boolean') return { ok: false, error: `${id} 缺少 requiresAppUpdate` };
    if (!m.files || typeof m.files !== 'object' || Object.keys(m.files).length === 0) return { ok: false, error: `${id} 沒有檔案` };
    for (const [p, f] of Object.entries(m.files)) {
      if (p.includes('..') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return { ok: false, error: `${id} 檔案路徑不安全：${p}` };
      if (!SHA256.test(f.sha256)) return { ok: false, error: `${id}/${p} 的 sha256 格式錯誤` };
      if (typeof f.url !== 'string' || !/^https?:\/\//.test(f.url)) return { ok: false, error: `${id}/${p} 的網址無效` };
    }
  }
  return { ok: true, catalog: c };
}

export function planCatalogUpdate(moduleId: ModuleId, installed: InstalledModule, target: CatalogModule): ModulePlan {
  const up = planUpdate(installed.files, Object.fromEntries(Object.entries(target.files).map(([p, f]) => [p, f.sha256])));
  // 本機已有且雜湊相同的檔案直接沿用（reuse）；其餘才下載。
  const download = up.download;
  const reuse = up.unchanged;
  return {
    moduleId,
    fromVersion: installed.version,
    toVersion: target.version,
    upToDate: installed.version === target.version && download.length === 0 && up.remove.length === 0,
    requiresAppUpdate: target.requiresAppUpdate,
    download,
    reuse,
    remove: up.remove,
  };
}
