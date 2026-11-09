// 內建模組的增量同步計畫（純函式）：比對應用程式內建檔案與本機已安裝的雜湊，決定要複製與刪除哪些檔案。
// 模組不獨立下載；版本升級時由應用程式啟動流程呼叫，只處理有變動的檔案。
export interface InstalledBundle {
  version: string | null;
  files: Record<string, string>;
}

export interface BundleSyncPlan {
  /** 本機已與內建完全一致，不需要任何動作。 */
  upToDate: boolean;
  /** 首次安裝（本機沒有任何紀錄）。 */
  firstInstall: boolean;
  /** 需要從內建複製到本機的檔案（新增或內容改變）。 */
  copy: string[];
  /** 內建已不存在、需要從本機刪除的檔案。 */
  remove: string[];
}

export function planBundleSync(version: string, bundled: Record<string, string>, installed: InstalledBundle | null): BundleSyncPlan {
  const firstInstall = installed === null;
  const prev = installed ?? { version: null, files: {} };
  const copy = Object.keys(bundled).filter((name) => prev.files[name] !== bundled[name]);
  const remove = Object.keys(prev.files).filter((name) => !(name in bundled));
  const upToDate = !firstInstall && prev.version === version && copy.length === 0 && remove.length === 0;
  return { upToDate, firstInstall, copy, remove };
}
