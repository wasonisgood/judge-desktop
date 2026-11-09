// 雲端資料層（AI）：依設定組出 AI 設定（API 金鑰或工作負載身分聯合），並包成 requireAi。
// 所有 AI 產出都必須經過 requireAi；沒有金鑰時直接報錯，不會退回規則式的文字切割。
import * as fs from 'node:fs/promises';
import {
  FederatedTokenProvider, type FederationConfig, LocalCloudRouter, type AiComplete,
} from '@judge/core';
import { callAi, type AiConfig } from '../../ai';
import { readSettings, decryptKey } from '../local/settingsStore';
import { localBackendIfReady } from '../../localAi';

const federationProviders = new Map<string, FederatedTokenProvider>();

export async function aiConfigOrThrow(): Promise<AiConfig> {
  const s = await readSettings();
  if (s.aiAuthMode === 'federation') {
    const f = s.federation;
    if (s.aiProvider !== 'anthropic') throw new Error('工作負載身分聯合目前只支援 Anthropic 服務，請到「設定」改用 API 金鑰。');
    if (!f.organizationId || !f.federationRuleId || !f.serviceAccountId || !f.identityTokenFile) {
      throw new Error('尚未完成工作負載身分聯合設定（組織 ID、聯合規則 ID、服務帳號 ID、身分憑證檔）。');
    }
    const cacheKey = JSON.stringify([s.aiBaseUrl, f]);
    let provider = federationProviders.get(cacheKey);
    if (!provider) {
      const cfg: FederationConfig = {
        baseUrl: s.aiBaseUrl,
        organizationId: f.organizationId,
        federationRuleId: f.federationRuleId,
        serviceAccountId: f.serviceAccountId,
        workspaceId: f.workspaceId || undefined,
      };
      provider = new FederatedTokenProvider(cfg, async () => (await fs.readFile(f.identityTokenFile, 'utf8')).trim());
      federationProviders.set(cacheKey, provider);
    }
    const token = await provider.get();
    return { provider: 'anthropic', baseUrl: s.aiBaseUrl, model: s.aiModel, apiKey: token, authMode: 'bearer' };
  }
  const key = decryptKey(s.aiKeyEnc);
  if (!key) throw new Error('尚未設定 AI 金鑰，請到「設定」輸入。');
  return { provider: s.aiProvider, baseUrl: s.aiBaseUrl, model: s.aiModel, apiKey: key, authMode: 'apiKey' };
}

/** 本地 AI 已安裝並註冊時先走本地（Ollama），失敗或冷卻中則自動回退雲端。沒有安裝時行為與以前相同。 */
export async function requireAi(): Promise<AiComplete> {
  const cfg = await aiConfigOrThrow();
  const local = await localBackendIfReady();
  const cloud = { kind: 'cloud' as const, run: async <T>(_t: unknown, payload: unknown) => callAi(cfg, payload as { system: string; user: string; maxTokens: number }) as unknown as T };
  const router = new LocalCloudRouter(local, cloud);
  if (local) router.registerLocalReady();
  // 本地後端讀 prompt、雲端讀 user，因此兩者都放入同一份內容。
  return async (system, user, maxTokens) => (await router.route<string>('judgment', { system, user, prompt: user, maxTokens })).value;
}

