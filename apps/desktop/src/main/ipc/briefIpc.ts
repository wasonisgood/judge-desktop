// IPC：單一判決精讀與匯出。
import { ipcMain } from 'electron';
import type { BriefField, BriefDocument, JudgmentDetail } from '@judge/core';
import { buildBriefDocx } from '../exporters';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { autoSaveExport } from '../services/exportService';
import { runBrief } from '../services/briefService';

export function registerBriefIpc(): void {
  ipcMain.handle('brief:run', async (_e, args: { judgmentId: string; focus: string; lengthHint: string; fields?: BriefField[]; jurisdiction?: string; ai?: string }) => {
    const ai = await requireAi(normalizeAiMode(args.ai));
    return runBrief(args, ai);
  });
  ipcMain.handle('export:brief', async (_e, args: { detail: JudgmentDetail; doc: BriefDocument }) => {
    return autoSaveExport(`判決精讀_${args.detail.meta.caseNo ?? args.detail.meta.id}.docx`, await buildBriefDocx(args.detail, args.doc));
  });
}
