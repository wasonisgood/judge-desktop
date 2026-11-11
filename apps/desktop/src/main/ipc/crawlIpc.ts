// IPC：文本擷取（JudgementsCrawler 五步流程）。每一步登記為背景工作（kind 'crawl'），可由工作橫幅取消；進度以 crawl:progress 推送。
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { runCrawlStep, type CrawlRunArgs } from '../services/crawlService';
import { withJob } from '../services/jobRegistry';
import { safeSend } from '../services/safeSend';
import { toUserError } from '../services/userError';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { importTableFile, isStandardCrawlList, writeStandardCrawlList, IMPORT_EXTENSIONS } from '../services/tableImport';

export function registerCrawlIpc(): void {
  ipcMain.handle('crawl:pickFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      properties: ['openFile' as const],
      filters: [{ name: '判決清單（任何常見格式）', extensions: IMPORT_EXTENSIONS }],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    // 標準清單（Index／Title／URL）直接使用；其他格式由 AI 判斷欄位後，轉成標準清單（與原檔同一資料夾）。
    if (await isStandardCrawlList(file)) return file;
    const ai = await requireAi(normalizeAiMode('auto'));
    const result = await importTableFile(file, ai);
    return writeStandardCrawlList(file, result.items);
  });

  ipcMain.handle('crawl:run', (e, args: CrawlRunArgs & { runId: string }) =>
    withJob(args.runId, 'crawl', `文本擷取 Step ${args.step}`, async (signal) => {
      try {
        return await runCrawlStep(args, signal, (p) => safeSend(e.sender, 'crawl:progress', p));
      } catch (err) {
        throw toUserError(err);
      }
    }));
}
