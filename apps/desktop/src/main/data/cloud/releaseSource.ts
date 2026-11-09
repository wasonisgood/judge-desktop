// 雲端資料層：引擎資產與模組目錄的來源。先 Firebase Storage 鏡像，再 GitHub；都必須通過 SHA-256 校驗。
import {
  findVerifiedAsset, firebaseMirrorUrl, type GithubAssetJson,
} from '@judge/core';

const GITHUB_RELEASE_API = 'https://api.github.com/repos/ollama/ollama/releases/latest';

export interface EngineAsset {
  name: string;
  size: number;
  sha256: string;
  urls: string[];
}

/** 取得引擎資產的下載來源與 SHA-256。沒有已驗證摘要的資產一律拒絕。 */
export async function fetchLatestAsset(name: string): Promise<EngineAsset> {
  const override = process.env.JUDGE_OLLAMA_ZIP_URL;
  if (override) {
    const sha = process.env.JUDGE_OLLAMA_ZIP_SHA256 || '';
    if (!/^[0-9a-f]{64}$/i.test(sha)) throw new Error('測試用引擎網址缺少 JUDGE_OLLAMA_ZIP_SHA256');
    return { name, size: 0, sha256: sha.toLowerCase(), urls: [override] };
  }
  const res = await fetch(GITHUB_RELEASE_API, { headers: { 'user-agent': 'judge-desktop', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`無法取得引擎版本資訊（HTTP ${res.status}）`);
  const json = (await res.json()) as { tag_name: string; assets: GithubAssetJson[] };
  const a = findVerifiedAsset(json.assets, name);
  if (!a || !a.url) throw new Error(`找不到已驗證摘要的引擎資產 ${name}（沒有 SHA-256，拒絕安裝）`);
  return { name, size: a.size, sha256: a.sha256, urls: [firebaseMirrorUrl(`judge-desktop/engine/${name}`), a.url] };
}
