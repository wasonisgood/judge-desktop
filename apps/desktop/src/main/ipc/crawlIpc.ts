// IPC：文本擷取（JudgementsCrawler 五步流程）。每一步登記為背景工作（kind 'crawl'），可由工作橫幅取消；進度以 crawl:progress 推送。
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { runCrawlStep, type CrawlRunArgs } from '../services/crawlService';
import { withJob } from '../services/jobRegistry';
import { safeSend } from '../services/safeSend';
import { toUserError } from '../services/userError';

export function registerCrawlIpc(): void {
  ipcMain.handle('crawl:pickFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      properties: ['openFile' as const],
      filters: [{ name: '清單（Excel 或 CSV）', extensions: ['xlsx', 'csv'] }],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
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
