// Ollama 本地服務客戶端：檢查服務、拉取模型（NDJSON 串流）、以聊天 API 生成回答。
// 全部透過注入的 fetch 進行，測試時使用假資料。預設位址 http://127.0.0.1:11434。
import type { RouterBackend, TaskKind } from './router';
import { readNdjsonStream } from '../engine/stream';

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

export interface OllamaOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** 解析 NDJSON（每行一個 JSON）。忽略空行；遇到壞行會拋錯並指出行號。 */
export function parseNdjson(text: string): any[] {
  const out: any[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      out.push(JSON.parse(t));
    } catch {
      throw new Error(`NDJSON 第 ${i + 1} 行無法解析`);
    }
  });
  return out;
}

/** 檢查 Ollama 服務是否在執行，回傳版本字串；失敗回傳 null。 */
export async function getOllamaVersion(opts: OllamaOptions = {}): Promise<string | null> {
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(`${opts.baseUrl ?? OLLAMA_DEFAULT_URL}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

/** 確認模型是否已安裝（/api/tags 列表）。 */
export async function hasModel(model: string, opts: OllamaOptions = {}): Promise<boolean> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${opts.baseUrl ?? OLLAMA_DEFAULT_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return false;
  const j: any = await res.json();
  return (j.models ?? []).some((m: any) => m.name === model || m.model === model);
}

export interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
}

/**
 * 拉取模型。回應為 NDJSON；若任一行含 error 則拋出；必須收到 status === 'success' 才算完成。
 * 此函式以 text() 讀完整個回應，適合小檔與測試；大模型下載的串流進度由桌面端另行處理。
 */
export async function pullModel(
  model: string,
  onProgress: (p: PullProgress) => void,
  opts: OllamaOptions = {},
): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${opts.baseUrl ?? OLLAMA_DEFAULT_URL}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!res.ok) throw new Error(`拉取模型失敗（HTTP ${res.status}）`);
  let sawSuccess = false;
  const onLine = (l: any) => {
    if (l.error) throw new Error(`拉取模型失敗：${l.error}`);
    if (l.status === 'success') sawSuccess = true;
    onProgress({ status: l.status, completed: l.completed, total: l.total });
  };
  if (res.body) {
    // 串流解析：大型模型不會整個載入記憶體。
    await readNdjsonStream(res.body, onLine);
  } else {
    for (const l of parseNdjson(await res.text())) onLine(l);
  }
  if (!sawSuccess) throw new Error('拉取模型未完成（沒有收到 success）');
}

/** 以 Ollama 聊天 API 作為本地後端。精讀用 judgment 模型，回答用 chat 模型。 */
export class OllamaBackend implements RouterBackend {
  readonly kind = 'local' as const;
  constructor(
    private readonly models: { judgment: string; chat: string },
    private readonly opts: OllamaOptions = {},
  ) {}

  async run<T>(task: TaskKind, payload: unknown): Promise<T> {
    const f = this.opts.fetchImpl ?? fetch;
    const model = task === 'judgment' ? this.models.judgment : this.models.chat;
    const p = payload as { prompt?: string; system?: string };
    const res = await f(`${this.opts.baseUrl ?? OLLAMA_DEFAULT_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          ...(p.system ? [{ role: 'system', content: p.system }] : []),
          { role: 'user', content: p.prompt ?? '' },
        ],
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) throw new Error(`本地模型回應錯誤（HTTP ${res.status}）`);
    const j: any = await res.json();
    const text = j?.message?.content;
    if (typeof text !== 'string') throw new Error('本地模型回應格式不正確');
    return { text, model } as unknown as T;
  }
}
