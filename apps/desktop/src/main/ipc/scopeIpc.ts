// IPC：範圍整理表（法名確認、法條沿革、現行法規、執行、匯出）。
import { ipcMain } from 'electron';
import { type ScopeSheet, buildScopeWorkbook, buildScopeDocx } from '../scopeExporters';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { resolveStatute, currentLawFor } from '../data/cloud/lawRepo';
import { autoSaveExport, stamp } from '../services/exportService';
import { runScope, type ScopeRunArgs } from '../services/scopeService';

export function registerScopeIpc(): void {
  ipcMain.handle('law:resolve', async (_e, args: { name: string }) => {
    return resolveStatute(args.name);
  });
  ipcMain.handle('law:current', async (_e, args: { pcode: string }) => {
    return currentLawFor(args.pcode);
  });
  ipcMain.handle('scope:run', async (e, args: ScopeRunArgs) => {
    const ai = await requireAi(normalizeAiMode(args.ai));
    return runScope(args, ai, (p) => e.sender.send('scope:progress', p));
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
