// IPC：自然語言輸入（判斷關鍵字或自然語言；自然語言才呼叫 AI 整理成欄位或標準列）。
import { ipcMain } from 'electron';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { interpretInput, interpretCriteria, type NlPage, type NlResult, type NlCriteriaResult } from '@judge/core';
import { toUserError } from '../services/userError';

export function registerNlIpc(): void {
  ipcMain.handle('nl:interpret', async (_e, args: { page: NlPage; text: string; ai?: string }): Promise<NlResult> => {
    try {
      return await interpretInput(() => requireAi(normalizeAiMode(args.ai)), args.page, String(args.text ?? ''));
    } catch (err) {
      throw toUserError(err);
    }
  });

  ipcMain.handle('nl:criteria', async (_e, args: { text: string; ai?: string }): Promise<NlCriteriaResult> => {
    try {
      return await interpretCriteria(() => requireAi(normalizeAiMode(args.ai)), String(args.text ?? ''));
    } catch (err) {
      throw toUserError(err);
    }
  });
}
