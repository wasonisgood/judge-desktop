// 爭點知識庫 IPC：設定頁查詢安裝狀態、手動更新知識庫（issue #5）。
import { ipcMain } from 'electron';
import { knowledgeStatus, installKnowledgeModule } from '../services/knowledgeService';

export function registerKnowledgeIpc(): void {
  ipcMain.handle('knowledge:status', () => knowledgeStatus());
  ipcMain.handle('knowledge:install', async () => {
    const r = await installKnowledgeModule();
    if (!r.ok) throw new Error(r.error ?? '知識庫安裝失敗');
    return { ...knowledgeStatus(), upToDate: r.upToDate ?? false };
  });
}
