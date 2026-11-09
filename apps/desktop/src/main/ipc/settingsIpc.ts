// IPC：設定、快取清除與 AI 連線測試。金鑰只以加密形式保存，回傳給畫面的只有「是否已設定」。
import { ipcMain } from 'electron';
import { callAi } from '../ai';
import { readSettings, writeSettings, decryptKey, encryptKey, EMPTY_FEDERATION, type StoredSettings } from '../data/local/settingsStore';
import { cacheClear } from '../data/local/cacheStore';
import { aiConfigOrThrow } from '../data/cloud/aiRepo';
import {
  jurisdictionRegistry, checkFederationFields, FEDERATION_ISSUER, FEDERATION_AUDIENCE, FEDERATION_TOKEN_TTL_SECONDS, FEDERATION_SUBJECT_PATTERN,
} from '@judge/core';
import { readSession } from '../data/local/authStore';
import { fetchIdentityToken } from '../data/cloud/authRepo';

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', async () => {
    const s = await readSettings();
    return {
      aiProvider: s.aiProvider,
      aiAuthMode: s.aiAuthMode,
      federation: s.federation,
      aiBaseUrl: s.aiBaseUrl,
      aiModel: s.aiModel,
      hasKey: !!decryptKey(s.aiKeyEnc),
      defaultMaxItems: s.defaultMaxItems,
      cacheDays: s.cacheDays,
      briefFields: s.briefFields,
      localAiEnabled: s.localAiEnabled,
      defaultJurisdiction: s.defaultJurisdiction,
      aiUsdPerMillion: s.aiUsdPerMillion,
    };
  });
  // 聯盟設定狀態（v3.7.0）：即時檢查欄位與登入狀態，給畫面逐步引導用。
  ipcMain.handle('federation:status', async () => {
    const s = await readSettings();
    const f = { ...s.federation, identitySource: s.federation.identitySource ?? 'provider' } as const;
    return {
      mode: s.aiAuthMode,
      source: f.identitySource,
      problems: checkFederationFields(f),
      hasSession: !!(await readSession()),
      issuer: FEDERATION_ISSUER,
      audience: FEDERATION_AUDIENCE,
      tokenTtlSeconds: FEDERATION_TOKEN_TTL_SECONDS,
      subjectPattern: FEDERATION_SUBJECT_PATTERN,
      values: { organizationId: f.organizationId, federationRuleId: f.federationRuleId, serviceAccountId: f.serviceAccountId, workspaceId: f.workspaceId, identityTokenFile: f.identityTokenFile },
    };
  });
  // 草稿檢查（v3.7.0）：畫面上還沒按儲存的內容，也即時檢查（不寫入設定）。
  ipcMain.handle('federation:check', async (_e, args: { organizationId: string; federationRuleId: string; serviceAccountId: string; workspaceId: string; identitySource: 'provider' | 'file'; identityTokenFile: string }) => {
    const f = {
      organizationId: String(args?.organizationId ?? ''), federationRuleId: String(args?.federationRuleId ?? ''),
      serviceAccountId: String(args?.serviceAccountId ?? ''), workspaceId: String(args?.workspaceId ?? ''),
      identitySource: args?.identitySource === 'file' ? 'file' as const : 'provider' as const,
      identityTokenFile: String(args?.identityTokenFile ?? ''),
    };
    return { problems: checkFederationFields(f), hasSession: !!(await readSession()) };
  });
  // 預覽本工具的主體（sub）：用目前登入權杖申請一次身分權杖，只回傳 sub（權杖本身不回傳畫面）。
  ipcMain.handle('federation:previewSub', async () => {
    const session = await readSession();
    if (!session) throw new Error('尚未登入：請先登入本工具。');
    const { identityToken } = await fetchIdentityToken(session.accessToken);
    const payload = JSON.parse(Buffer.from(identityToken.split('.')[1], 'base64url').toString());
    return { sub: String(payload.sub), issuer: String(payload.iss), audience: String(payload.aud) };
  });
  ipcMain.handle('jurisdictions:list', () => jurisdictionRegistry.list().map((j) => ({
    id: j.id, name: j.name, country: j.country, statuteLookup: j.statuteLookup,
  })));
  ipcMain.handle('settings:set', async (_e, patch: Partial<StoredSettings> & { apiKey?: string; clearKey?: boolean }) => {
    const next: StoredSettings = { ...(await readSettings()) };
    for (const k of ['aiProvider', 'aiAuthMode', 'aiBaseUrl', 'aiModel', 'defaultMaxItems', 'cacheDays', 'localAiEnabled', 'defaultJurisdiction'] as const) {
      if (patch[k] !== undefined) (next as any)[k] = patch[k];
    }
    if (patch.aiUsdPerMillion !== undefined) {
      const v = patch.aiUsdPerMillion === null ? null : Number(patch.aiUsdPerMillion);
      if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error('AI 單價必須是 0 或正數');
      next.aiUsdPerMillion = v;
    }
    if (patch.defaultJurisdiction && !jurisdictionRegistry.has(patch.defaultJurisdiction)) {
      throw new Error(`未知的管轄區：${patch.defaultJurisdiction}`);
    }
    if (patch.briefFields) {
      next.briefFields = (patch.briefFields as StoredSettings['briefFields']).filter((f) => f && typeof f.name === 'string');
    }
    if (patch.federation) {
      next.federation = { ...EMPTY_FEDERATION, ...next.federation, ...patch.federation };
    }
    if (next.aiAuthMode === 'federation') next.aiProvider = 'anthropic';
    if (patch.clearKey) next.aiKeyEnc = null;
    if (patch.apiKey) next.aiKeyEnc = encryptKey(patch.apiKey.trim());
    await writeSettings(next);
    return { ok: true };
  });
  ipcMain.handle('cache:clear', async () => {
    await cacheClear();
    return { ok: true };
  });
  ipcMain.handle('ai:test', async () => {
    const cfg = await aiConfigOrThrow();
    const text = await callAi(cfg, { system: '你是測試助手。', user: '只回答：OK', maxTokens: 16 });
    return { ok: true, reply: text.slice(0, 80) };
  });
}
