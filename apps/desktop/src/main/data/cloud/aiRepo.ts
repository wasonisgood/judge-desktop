// 雲端資料層（AI）：依設定組出 AI 設定（API 金鑰或工作負載身分聯合），並包成 requireAi。
// 所有 AI 產出都必須經過 requireAi；沒有金鑰時直接報錯，不會退回規則式的文字切割。
import * as fs from 'node:fs/promises';
import { raceAbort } from '@judge/core';
import {
  FederatedTokenProvider, type FederationConfig, LocalCloudRouter, type AiComplete, checkFederationFields,
} from '@judge/core';
import { callAi, type AiConfig } from '../../ai';
import { fetchIdentityToken } from './authRepo';
import { readSession } from '../local/authStore';
import { readSettings, decryptKey } from '../local/settingsStore';
import { localBackendIfReady } from '../../localAi';

const federationProviders = new Map<string, FederatedTokenProvider>();

export async function aiConfigOrThrow(): Promise<AiConfig> {
  const s = await readSettings();
  if (s.aiAuthMode === 'federation') {
    const f = s.federation;
    if (s.aiProvider !== 'anthropic') throw new Error('工作負載身分聯合目前只支援 Anthropic 服務，請到「設定」改用 API 金鑰。');
    const problems = checkFederationFields({ ...f, identitySource: f.identitySource ?? 'provider' });
    if (problems.length) throw new Error('工作負載身分聯盟設定尚未完成：' + problems.map((p) => p.message).join(' '));
    const source = f.identitySource ?? 'provider';
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
      provider = new FederatedTokenProvider(cfg, async () => {
        if (source === 'file') return (await fs.readFile(f.identityTokenFile, 'utf8')).trim();
        // 本工具簽發：以目前登入的授權權杖申請身分權杖（每次換取前重新申請，權杖短效且一次性）。
        const session = await readSession();
        if (!session) throw new Error('尚未登入：請先登入本工具，才能使用工作負載身分聯盟。');
        return (await fetchIdentityToken(session.accessToken)).identityToken;
      });
      federationProviders.set(cacheKey, provider);
    }
    const token = await provider.get();
    return { provider: 'anthropic', baseUrl: s.aiBaseUrl, model: s.aiModel, apiKey: token, authMode: 'bearer' };
  }
  const key = decryptKey(s.aiKeyEnc);
  if (!key) throw new Error('尚未設定 AI 金鑰，請到「設定」輸入。');
  return { provider: s.aiProvider, baseUrl: s.aiBaseUrl, model: s.aiModel, apiKey: key, authMode: 'apiKey' };
}

/** AI 來源：auto＝本地就緒時優先、失敗回退雲端；local＝只用本地（未就緒即報錯）；cloud＝只用雲端。 */
export type AiMode = 'auto' | 'local' | 'cloud';

export function normalizeAiMode(v: unknown): AiMode {
  return v === 'local' || v === 'cloud' ? v : 'auto';
}

/** 依來源選擇回傳 AI 呼叫函式。signal 觸發時：雲端請求立即中止；本地請求的結果被捨棄並拋出取消（v3.6.0）。 */
export async function requireAi(mode: AiMode = 'auto', signal?: AbortSignal): Promise<AiComplete> {
  const cfg = await aiConfigOrThrow();
  const cloud = { kind: 'cloud' as const, run: async <T>(_t: unknown, payload: unknown) => callAi(cfg, payload as { system: string; user: string; maxTokens: number }, signal) as unknown as T };
  const guard = (fn: AiComplete): AiComplete => (system, user, maxTokens) => raceAbort(fn(system, user, maxTokens), signal);
  if (mode === 'cloud') {
    return guard(async (system, user, maxTokens) => (await cloud.run<{ text: string }>('judgment', { system, user, prompt: user, maxTokens })) as unknown as string);
  }
  if (mode === 'local') {
    const local = await localBackendIfReady({ ignoreSwitch: true });
    if (!local) throw new Error('本地模型尚未就緒（請到設定的「模組」安裝本地 AI），或改選雲端。');
    return guard(async (system, user, maxTokens) => (await local.run<string>('judgment', { system, user, prompt: user, maxTokens })));
  }
  const local = await localBackendIfReady();
  const router = new LocalCloudRouter(local, cloud);
  if (local) router.registerLocalReady();
  // 本地後端讀 prompt、雲端讀 user，因此兩者都放入同一份內容。
  return guard(async (system, user, maxTokens) => (await router.route<string>('judgment', { system, user, prompt: user, maxTokens })).value);
}

