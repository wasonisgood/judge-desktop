// IPC：範圍整理表（法名確認、法條沿革、現行法規、執行、匯出）。範圍整理登記為背景工作，可取消（v3.6.0）。
import { ipcMain } from 'electron';
import { type ScopeSheet, buildScopeWorkbook, buildScopeDocx } from '../scopeExporters';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { resolveStatute, currentLawFor } from '../data/cloud/lawRepo';
import { autoSaveExport, stamp } from '../services/exportService';
import { runScope, scopeTitle, type ScopeRunArgs } from '../services/scopeService';
import { withJob } from '../services/jobRegistry';
import { safeSend } from '../services/safeSend';
import { toUserError } from '../services/userError';

export function registerScopeIpc(): void {
  ipcMain.handle('law:resolve', async (_e, args: { name: string }) => {
    try {
      return await resolveStatute(args.name);
    } catch (err) {
      throw toUserError(err);
    }
  });
  ipcMain.handle('law:current', async (_e, args: { pcode: string }) => {
    return currentLawFor(args.pcode);
  });
  ipcMain.handle('scope:run', (e, args: ScopeRunArgs & { runId: string }) =>
    withJob(args.runId, 'scope', `標編碼標注工序：${scopeTitle(args)}`, async (signal) => {
      // AI 分析關閉時不需要金鑰；開啟但沒有可用的 AI 時改為傳統篩選，並在結果的說明中記錄。
      let ai = null;
      if (args.aiAnalysis !== false) {
        try { ai = await requireAi(normalizeAiMode(args.ai), signal); } catch { ai = null; }
      }
      try {
        return await runScope(args, ai, (p) => safeSend(e.sender, 'scope:progress', p), signal);
      } catch (err) {
        throw toUserError(err);
      }
    }));
  ipcMain.handle('export:scope', async (_e, args: { sheets: ScopeSheet[]; yearFrom?: number; yearTo?: number; format: 'xlsx' | 'docx' }) => {
    const ext = args.format;
    const meta = { yearFrom: args.yearFrom, yearTo: args.yearTo };
    const buf = ext === 'xlsx'
      ? await buildScopeWorkbook(args.sheets, meta)
      : await buildScopeDocx(args.sheets, meta);
    return autoSaveExport(`範圍整理表_${stamp()}.${ext}`, buf);
  });
}
