// 引擎健康檢查與自動啟動：檢查服務是否回應；沒有回應時呼叫 startService，並以退避輪詢等待。
// 所有外部動作（HTTP、啟動程序、等待）都可注入，方便測試。
import { getOllamaVersion, OLLAMA_DEFAULT_URL } from '../local/ollama';

export interface EngineHealth {
  ok: boolean;
  version: string | null;
  startAttempts: number;
  waitedMs: number;
}

export interface EnsureOptions {
  baseUrl?: string;
  /** 啟動服務（桌面端：spawn `ollama serve`）。可以是 undefined，表示只檢查不啟動。 */
  startService?: () => Promise<void> | void;
  /** 啟動後最長等待時間。 */
  maxWaitMs?: number;
  /** 啟動最多嘗試次數。 */
  maxStartAttempts?: number;
  probe?: (baseUrl: string) => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function ensureEngineRunning(opts: EnsureOptions = {}): Promise<EngineHealth> {
  const baseUrl = opts.baseUrl ?? OLLAMA_DEFAULT_URL;
  const probe = opts.probe ?? ((u: string) => getOllamaVersion({ baseUrl: u }));
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const maxWait = opts.maxWaitMs ?? 60_000;
  const maxStarts = opts.maxStartAttempts ?? 2;
  const t0 = now();

  let v = await probe(baseUrl);
  if (v) return { ok: true, version: v, startAttempts: 0, waitedMs: 0 };
  if (!opts.startService) return { ok: false, version: null, startAttempts: 0, waitedMs: 0 };

  for (let attempt = 1; attempt <= maxStarts; attempt++) {
    await opts.startService();
    // 每次啟動各自有等待時限（maxWaitMs），避免第一次等太久就沒有機會重試。
    // 退避輪詢：0.5s、1s、2s…，最長 4s 一次。
    const attemptStart = now();
    let delay = 500;
    while (now() - attemptStart < maxWait) {
      await sleep(delay);
      v = await probe(baseUrl);
      if (v) return { ok: true, version: v, startAttempts: attempt, waitedMs: now() - t0 };
      delay = Math.min(delay * 2, 4000);
    }
  }
  return { ok: false, version: null, startAttempts: maxStarts, waitedMs: now() - t0 };
}
