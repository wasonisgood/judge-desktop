// 爬取模組的網路前置檢查：一般網路、司法院網域（含 VPN 情境）。
// 透過注入的 fetch 進行，可在測試中以假資料取代，不實際連線。

export interface ProbeTarget {
  name: string;
  url: string;
  required: boolean;
}

export const DEFAULT_TARGETS: ProbeTarget[] = [
  { name: '一般網路', url: 'https://www.google.com/generate_204', required: false },
  { name: '司法院裁判書網站', url: 'https://judgment.judicial.gov.tw/', required: true },
];

export interface ProbeResult {
  name: string;
  ok: boolean;
  status?: number;
  error?: string;
  latencyMs: number;
}

export interface ProbeSummary {
  /** 必要目標全部通過才為 true。 */
  ready: boolean;
  results: ProbeResult[];
  /** 給使用者看的說明（失敗時說明原因）。 */
  messages: string[];
}

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  targets?: ProbeTarget[];
  now?: () => number;
}

/** 對每個目標發出 HEAD 請求（失敗時不視為錯誤以外的任何結論）。 */
export async function runNetworkProbe(opts: ProbeOptions = {}): Promise<ProbeSummary> {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const targets = opts.targets ?? DEFAULT_TARGETS;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const results: ProbeResult[] = [];
  for (const t of targets) {
    const start = now();
    try {
      const res = await doFetch(t.url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
      // 3xx 也代表連線成功（伺服器有回應）；5xx 視為伺服器異常。
      const ok = res.status < 500;
      results.push({ name: t.name, ok, status: res.status, latencyMs: now() - start, error: ok ? undefined : `伺服器回應 ${res.status}` });
    } catch (e: any) {
      results.push({ name: t.name, ok: false, latencyMs: now() - start, error: e?.name === 'TimeoutError' ? '連線逾時' : (e?.message ?? '連線失敗') });
    }
  }
  const messages: string[] = [];
  for (const [i, r] of results.entries()) {
    const t = targets[i];
    if (r.ok) messages.push(`${r.name}：通過（${r.latencyMs} ms）`);
    else if (t.required) messages.push(`${r.name}：無法連線（${r.error}）。若使用 VPN，請嘗試切換節點或暫時關閉後再試。`);
    else messages.push(`${r.name}：無法連線（${r.error}），不影響司法院檢索，但部分功能可能較慢。`);
  }
  const ready = results.every((r, i) => r.ok || !targets[i].required);
  return { ready, results, messages };
}
