// IPC：研究設計（AI 多輪對話）。對話紀錄存在本機（design-sessions.json）；AI 透過工具寫入欄位、試搜尋、帶入範圍整理。
import { ipcMain } from 'electron';
import { buildDesignSummary, designSummaryText } from '@judge/core';
import { type StoredDesign, buildView, listItemOf, applyFieldEdits } from '../designSession';
import { createSession, runDesignTurn } from '../designChat';
import { listDesigns, getDesign, putDesign, removeDesign } from '../data/local/designStore';
import { aiConfigOrThrow } from '../data/cloud/aiRepo';
import { cachedSearch } from '../data/cloud/courtRepo';
import { buildDesignDocx } from '../designExporters';
import { autoSaveExport, stamp } from '../services/exportService';
import { withJob } from '../services/jobRegistry';
import { toUserError } from '../services/userError';

async function must(id: string): Promise<StoredDesign> {
  const entry = await getDesign(id);
  if (!entry) throw new Error('找不到這筆研究設計，可能已被刪除');
  return entry;
}

async function save(entry: StoredDesign) {
  await putDesign(entry);
  return buildView(entry, entry.session.id);
}

export function registerDesignIpc(): void {
  ipcMain.handle('design:list', async () => (await listDesigns()).map(listItemOf));

  // 多輪對話：沒有 id 時建立新的研究設計；每一輪由 AI 回覆，並可呼叫寫入欄位、試搜尋、帶入範圍整理等工具。
  ipcMain.handle('design:chat', (_e, args: { runId: string; id?: string; text: string }) =>
    withJob(args.runId, 'assistant', '研究設計對話', async (signal) => {
      try {
        const cfg = await aiConfigOrThrow();
        let entry: StoredDesign;
        if (args.id) {
          entry = await must(args.id);
        } else {
          // 新設計：問題意識即第一句話（由 runDesignTurn 加入紀錄，因此這裡清空 turns）。
          const created = createSession(args.text);
          entry = { session: { ...created, turns: [] }, skipped: [] };
        }
        const { entry: next, result } = await runDesignTurn({ config: cfg, search: cachedSearch }, entry, args.text, signal);
        await putDesign(next);
        return { view: buildView(next, next.session.id), ...result };
      } catch (err) {
        throw toUserError(err);
      }
    }));

  ipcMain.handle('design:get', async (_e, args: { id: string }) => {
    const entry = await must(args.id);
    return buildView(entry, entry.session.id);
  });

  // 使用者在表單直接修改欄位（與 AI 寫入的欄位相同的驗證）。
  ipcMain.handle('design:setFields', async (_e, args: { id: string; fields: Record<string, unknown> }) => {
    const entry = await must(args.id);
    return save({ ...entry, session: applyFieldEdits(entry.session, args.fields ?? {}) });
  });

  ipcMain.handle('design:remove', async (_e, args: { id: string }) => ({ removed: await removeDesign(args.id) }));

  ipcMain.handle('design:export', async (_e, args: { id: string; format: 'docx' | 'txt' }) => {
    const entry = await must(args.id);
    const sum = buildDesignSummary(entry.session);
    if (args.format === 'txt') {
      return autoSaveExport(`研究設計摘要_${stamp()}.txt`, Buffer.from(designSummaryText(sum), 'utf8'));
    }
    return autoSaveExport(`研究設計摘要_${stamp()}.docx`, await buildDesignDocx(sum));
  });
}
