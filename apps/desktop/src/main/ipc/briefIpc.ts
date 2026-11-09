// IPC：單一判決精讀與匯出（v3.6.0：登記為背景工作，可取消）。
import { ipcMain } from 'electron';
import type { BriefField, BriefDocument, JudgmentDetail } from '@judge/core';
import { buildBriefDocx } from '../exporters';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { autoSaveExport } from '../services/exportService';
import { runBrief } from '../services/briefService';
import { withJob } from '../services/jobRegistry';
import { toUserError } from '../services/userError';

export function registerBriefIpc(): void {
  ipcMain.handle('brief:run', (_e, args: { runId: string; judgmentId: string; focus: string; lengthHint: string; fields?: BriefField[]; jurisdiction?: string; caseType?: string; ai?: string }) =>
    withJob(args.runId, 'brief', `精讀：${args.judgmentId}`, async (signal) => {
      let ai;
      try {
        ai = await requireAi(normalizeAiMode(args.ai), signal);
      } catch (err) {
        throw toUserError(err);
      }
      return runBrief(args, ai, signal);
    }));
  ipcMain.handle('export:brief', async (_e, args: { detail: JudgmentDetail; doc: BriefDocument }) => {
    return autoSaveExport(`判決精讀_${args.detail.meta.caseNo ?? args.detail.meta.id}.docx`, await buildBriefDocx(args.detail, args.doc));
  });
}
