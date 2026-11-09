// 本地資料層：Ollama 服務（本機）：列出模型、啟動自己的服務、測試用覆寫位址。
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { OWN_PORT, engineRoot } from './localPaths';

/** 測試用：指向模擬服務，不安裝任何東西。 */
export function engineBaseOverride(): string | null {
  return process.env.JUDGE_OLLAMA_URL || null;
}

export async function listModels(base: string): Promise<string[]> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** 以本程式自己的埠啟動 ollama serve（與使用者既有的服務分開）。 */
export function startOwnService(exe: string): void {
  const child = spawn(exe, ['serve'], {
    windowsHide: true, detached: true, stdio: 'ignore',
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${OWN_PORT}`, OLLAMA_MODELS: path.join(engineRoot(), 'models') },
  });
  child.on('error', (e) => console.error('本地服務無法啟動（SERVICE_DOWN）：', e.message));
  child.unref();
}
