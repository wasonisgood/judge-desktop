// 版本比較（語意化版本的主要部分）與既有安裝的沿用判斷。純函式。

/** 把 "0.5.1"、"v0.5.1-rc1" 解析為 [0,5,1]；無法解析回傳 null。 */
export function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

/** a < b → -1，a = b → 0，a > b → 1；任一無法解析回傳 null。 */
export function compareVersions(a: string | null, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export type ExistingEngineDecision =
  | { action: 'none'; reason: string }
  | { action: 'adopt'; reason: string }
  | { action: 'install-own'; reason: string };

/**
 * 既有服務（使用者自己安裝或其他程式啟動的 Ollama）能不能沿用：
 * - 沒有服務 → 安裝我們自己的。
 * - 版本低於最低要求 → 不沿用，另外安裝我們自己的新版（不會動原本的服務）。
 * - 版本夠新 → 沿用。
 */
export function decideExistingEngine(serviceVersion: string | null, minVersion: string): ExistingEngineDecision {
  if (!serviceVersion) return { action: 'none', reason: '沒有偵測到執行中的本地服務' };
  const c = compareVersions(serviceVersion, minVersion);
  if (c === null) return { action: 'install-own', reason: `無法判讀版本 ${serviceVersion}，改用本程式自行安裝的引擎` };
  if (c < 0) return { action: 'install-own', reason: `既有服務版本 ${serviceVersion} 低於需求 ${minVersion}，改用本程式自行安裝的新版引擎（原服務不受影響）` };
  return { action: 'adopt', reason: `既有服務版本 ${serviceVersion} 符合需求 ${minVersion}，直接沿用` };
}

/** 模型是否可用於此方案：已安裝且名稱符合方案所需。其他已安裝的模型一律保留、不刪除。 */
export function modelsToPull(required: string[], installed: string[]): string[] {
  return [...new Set(required)].filter((m) => !installed.includes(m));
}
