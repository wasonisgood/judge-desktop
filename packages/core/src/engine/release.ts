// 從 GitHub Releases API 的回應取出資產與 SHA-256 摘要。純函式。
// GitHub 會在每個資產提供 digest 欄位（格式 "sha256:<64 hex>"）；沒有摘要的資產一律拒絕，不會退回不校驗。

export interface GithubAssetJson {
  name: string;
  size?: number;
  digest?: string | null;
  browser_download_url?: string;
}

export interface VerifiedAsset {
  name: string;
  size: number;
  sha256: string;
  url: string | null;
}

export function findVerifiedAsset(assets: GithubAssetJson[], name: string): VerifiedAsset | null {
  const a = assets.find((x) => x.name === name);
  if (!a) return null;
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(a.digest ?? '');
  if (!m) return null;
  return { name: a.name, size: Number(a.size ?? 0), sha256: m[1].toLowerCase(), url: a.browser_download_url ?? null };
}

/** 檢查 zip 解壓的目標路徑是否會跳出目的資料夾（防止 zip-slip）。 */
export function isSafeZipEntry(entryName: string): boolean {
  const norm = entryName.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false;
  return !norm.split('/').some((seg) => seg === '..');
}
