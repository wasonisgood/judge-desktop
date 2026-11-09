// IPC：範圍整理表（法名確認、法條沿革、現行法規、執行、匯出、覆核）。範圍整理登記為背景工作，可取消（v3.6.0）。
import { ipcMain } from 'electron';
import { applyReviewOp, normalizeReviewPolicy, summarizeReview, type CellRef, type ReviewOp } from '@judge/core';
import { type ScopeSheet, buildScopeWorkbook, buildScopeDocx } from '../scopeExporters';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { resolveStatute, currentLawFor } from '../data/cloud/lawRepo';
import { readSettings } from '../data/local/settingsStore';
import { library } from '../data/local/libraryAccess';
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
      // 覆核門檻由主程序從設定讀入（不接受畫面傳入，避免畫面改寫規則）。
      const reviewPolicy = normalizeReviewPolicy((await readSettings()).scopeReviewPolicy);
      try {
        return await runScope({ ...args, reviewPolicy }, ai, (p) => safeSend(e.sender, 'scope:progress', p), signal);
      } catch (err) {
        throw toUserError(err);
      }
    }));
  // 覆核操作：套用到整批結果（核心純函式），有保存的項目時一併寫回「檔案」。
  // 沒有 op 時只回傳各表的覆核摘要（開啟舊結果時使用）。
  ipcMain.handle('scope:review', async (_e, args: { libraryId?: string | null; sheets: ScopeSheet[]; op?: ReviewOp }) => {
    const reviewPolicy = normalizeReviewPolicy((await readSettings()).scopeReviewPolicy);
    let sheets = args.sheets ?? [];
    let changed: CellRef[] = [];
    let saveError: string | null = null;
    if (args.op) {
      const r = applyReviewOp(sheets, args.op, reviewPolicy, new Date().toISOString());
      sheets = r.sheets;
      changed = r.changed;
      if (args.libraryId) {
        try {
          const found = await library().mergePayload(args.libraryId, { sheets });
          if (!found) saveError = '找不到這筆已保存的結果，覆核只保留在畫面上，匯出時會包含目前的覆核狀態。';
        } catch (err) {
          saveError = `覆核狀態沒有寫回「檔案」（${err instanceof Error ? err.message : String(err)}），請及時匯出。`;
        }
      }
    }
    return { sheets, changed, summaries: sheets.map((sh) => summarizeReview(sh, reviewPolicy)), saveError };
  });
  ipcMain.handle('export:scope', async (_e, args: { sheets: ScopeSheet[]; yearFrom?: number; yearTo?: number; format: 'xlsx' | 'docx' }) => {
    const ext = args.format;
    const meta = { yearFrom: args.yearFrom, yearTo: args.yearTo };
    const buf = ext === 'xlsx'
      ? await buildScopeWorkbook(args.sheets, meta)
      : await buildScopeDocx(args.sheets, meta);
    return autoSaveExport(`範圍整理表_${stamp()}.${ext}`, buf);
  });
}
