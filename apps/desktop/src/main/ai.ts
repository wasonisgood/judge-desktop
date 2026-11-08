// AI 呼叫：Anthropic 原生 Messages API 與 OpenAI 相容的 chat/completions。金鑰只在主程序使用，不會傳給畫面。

export interface AiConfig {
  provider: 'anthropic' | 'openai-compatible';
  baseUrl: string;
  model: string;
  /** API 金鑰；使用工作負載身分聯合時，這裡放的是換得的短期權杖。 */
  apiKey: string;
  /** 'apiKey' 以 x-api-key 送出；'bearer' 以 Authorization: Bearer 送出（工作負載身分聯合）。 */
  authMode?: 'apiKey' | 'bearer';
}

/** Anthropic 原生 API 的認證標頭。 */
export function anthropicAuthHeaders(cfg: AiConfig): Record<string, string> {
  const base: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (cfg.authMode === 'bearer') return { ...base, authorization: `Bearer ${cfg.apiKey}` };
  return { ...base, 'x-api-key': cfg.apiKey };
}

export interface AiCall {
  system: string;
  user: string;
  maxTokens: number;
}

export async function callAi(cfg: AiConfig, call: AiCall): Promise<string> {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const signal = AbortSignal.timeout(120_000);
  if (cfg.provider === 'anthropic') {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      signal,
      headers: anthropicAuthHeaders(cfg),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages: [{ role: 'user', content: call.user }],
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`AI 服務回傳 ${res.status}：${json?.error?.message ?? '未知錯誤'}`);
    return (json.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: call.maxTokens,
      messages: [
        { role: 'system', content: call.system },
        { role: 'user', content: call.user },
      ],
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI 服務回傳 ${res.status}：${json?.error?.message ?? '未知錯誤'}`);
  return String(json?.choices?.[0]?.message?.content ?? '').trim();
}
