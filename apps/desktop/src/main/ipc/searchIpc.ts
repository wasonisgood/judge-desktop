// IPC：判決列表（檢索、AI 相關性篩選、匯出）與單一判決的候選查找。
import { ipcMain } from 'electron';
import { screenRelevance, judgmentQueries, type RelevanceItem, type JudgmentDetail, type JudgmentSummary } from '@judge/core';
import { buildListWorkbook } from '../exporters';
import { cachedSearch, cachedDetail } from '../data/cloud/courtRepo';
import { requireAi } from '../data/cloud/aiRepo';
import { library } from '../data/local/libraryAccess';
import { autoSaveExport, stamp } from '../services/exportService';

export function registerSearchIpc(): void {
  ipcMain.handle('search:screen', async (_e, args: { topic: string; items: RelevanceItem[] }) => {
    const ai = await requireAi();
    return screenRelevance(ai, args.topic, args.items.slice(0, 40));
  });
  ipcMain.handle('search:run', async (e, args: { keyword: string; courtCode?: string; maxItems: number; includeFullText: boolean }) => {
    const items = await cachedSearch(args.keyword, args.maxItems, args.courtCode);
    const details: Record<string, Pick<JudgmentDetail, 'meta' | 'sections' | 'fullText'> & { historyPosition: string }> = {};
    if (args.includeFullText) {
      let i = 0;
      for (const it of items) {
        i++;
        e.sender.send('search:progress', { done: i, total: items.length, id: it.id });
        const d = await cachedDetail(it.id);
        details[it.id] = { meta: d.meta, sections: d.sections, fullText: d.fullText, historyPosition: d.historyPosition?.summary ?? '' };
      }
    }
    await library().add({
      kind: 'list',
      title: `判決列表：${args.keyword}`,
      summary: `${items.length} 筆${args.includeFullText ? '（含全文）' : ''}`,
      payload: { keyword: args.keyword, items, details },
    });
    return { items, details };
  });
  ipcMain.handle('export:list', async (_e, args: { keyword: string; items: JudgmentSummary[]; details: Record<string, any> }) => {
    return autoSaveExport(`判決列表_${args.keyword}_${stamp()}.xlsx`, await buildListWorkbook({ keyword: args.keyword, items: args.items, details: args.details }));
  });
  // 單一判決：先搜尋、列出候選，再由使用者指定一則（鎖定單一判決）
  ipcMain.handle('judgment:find', async (_e, args: { query: string }) => {
    const seen = new Map<string, JudgmentSummary>();
    let note = '';
    for (const q of judgmentQueries(args.query)) {
      try {
        for (const it of await cachedSearch(q, 20)) if (!seen.has(it.id)) seen.set(it.id, it);
      } catch (err) {
        // 查無結果或暫時被限制查詢：不中斷，回報說明即可
        const msg = err instanceof Error ? err.message : String(err);
        note = /查無|風控/.test(msg) ? '司法院網站沒有查到結果，或暫時限制查詢，請稍後再試或換關鍵字。' : msg;
      }
    }
    return { items: [...seen.values()].slice(0, 30), note };
  });
}
