// IPC：設定、快取清除與 AI 連線測試。金鑰只以加密形式保存，回傳給畫面的只有「是否已設定」。
import { ipcMain } from 'electron';
import { callAi } from '../ai';
import { readSettings, writeSettings, decryptKey, encryptKey, EMPTY_FEDERATION, type StoredSettings } from '../data/local/settingsStore';
import { cacheClear } from '../data/local/cacheStore';
import { aiConfigOrThrow } from '../data/cloud/aiRepo';

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
    };
  });
  ipcMain.handle('settings:set', async (_e, patch: Partial<StoredSettings> & { apiKey?: string; clearKey?: boolean }) => {
    const next: StoredSettings = { ...(await readSettings()) };
    for (const k of ['aiProvider', 'aiAuthMode', 'aiBaseUrl', 'aiModel', 'defaultMaxItems', 'cacheDays'] as const) {
      if (patch[k] !== undefined) (next as any)[k] = patch[k];
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
