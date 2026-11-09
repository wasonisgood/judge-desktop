// IPC：研究設計引導（issue #11）。對話紀錄存在本機（design-sessions.json），AI 只用於整理欄位草稿。
import { ipcMain } from 'electron';
import { buildDesignSummary, designSummaryText } from '@judge/core';
import { type StoredDesign, buildView, listItemOf, startSession, answerCurrent, applyFieldEdits, acceptById, aiFillFields } from '../designSession';
import { listDesigns, getDesign, putDesign, removeDesign } from '../data/local/designStore';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { buildDesignDocx } from '../designExporters';
import { autoSaveExport, stamp } from '../services/exportService';

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

  ipcMain.handle('design:create', async (_e, args: { problem: string }) =>
    save({ session: startSession(args?.problem ?? ''), skipped: [] }));

  ipcMain.handle('design:get', async (_e, args: { id: string }) => {
    const entry = await must(args.id);
    return buildView(entry, entry.session.id);
  });

  ipcMain.handle('design:answer', async (_e, args: { id: string; text: string }) => {
    const entry = await must(args.id);
    return save({ ...entry, session: answerCurrent(entry.session, args.text ?? '') });
  });

  ipcMain.handle('design:setFields', async (_e, args: { id: string; fields: Record<string, unknown> }) => {
    const entry = await must(args.id);
    return save({ ...entry, session: applyFieldEdits(entry.session, args.fields ?? {}) });
  });

  // AI 只回傳欄位草稿，不寫入；研究者在表單確認後再按「儲存欄位」。
  ipcMain.handle('design:aiFill', async (_e, args: { text: string; ai?: string }) => {
    const ai = await requireAi(normalizeAiMode(args.ai));
    return { fields: await aiFillFields(ai, args.text ?? '') };
  });

  ipcMain.handle('design:accept', async (_e, args: { id: string; suggestionId: string }) => {
    const entry = await must(args.id);
    return save({ ...entry, session: acceptById(entry.session, args.suggestionId) });
  });

  ipcMain.handle('design:skip', async (_e, args: { id: string; suggestionId: string }) => {
    const entry = await must(args.id);
    const skipped = entry.skipped.includes(args.suggestionId) ? entry.skipped : [...entry.skipped, args.suggestionId];
    return save({ ...entry, skipped });
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
