// IPC：個案研究筆記（文字區段標注、註解、重新對位、Word 匯出、雲端同步狀態）。
// 判決全文一律經 cachedDetail 取得（快取優先），不另外重新呼叫司法院。
import { ipcMain } from 'electron';
import type { HighlightColor, AnnotationMode, JurisdictionId, JudgmentDetail } from '@judge/core';
import { HIGHLIGHT_COLORS, segmentText, DEFAULT_COLOR_LABELS } from '@judge/core';
import { buildAnnotatedDocx } from '../exporters';
import { autoSaveExport } from '../services/exportService';
import { cachedDetail } from '../data/cloud/courtRepo';
import { annotations } from '../data/local/annotationAccess';
import { withStatus, type JudgmentNoteMeta, type AnnotationView } from '../services/annotationService';
import { syncStatus } from '../services/annotationSync';
import { toUserError } from '../services/userError';

interface Target {
  judgmentId: string;
  /** 空字串或未指定時為預設管轄區（與精讀相同的快取鍵）。 */
  jurisdiction?: string;
}

const MODES: AnnotationMode[] = ['highlight', 'highlight_note'];

function metaOf(d: JudgmentDetail, jurisdiction: string): JudgmentNoteMeta {
  return {
    title: d.meta.title || d.meta.id,
    caseNo: d.meta.caseNo ?? '',
    court: d.meta.court ?? '',
    dateIso: d.meta.dateIso ?? d.meta.dateMinguo ?? '',
    cause: d.meta.cause ?? '',
    sourceUrl: d.meta.sourceUrl,
    jurisdiction,
  };
}

async function loadDetail(t: Target): Promise<{ d: JudgmentDetail; meta: JudgmentNoteMeta }> {
  const jurisdiction = t.jurisdiction || '';
  try {
    const d = await cachedDetail(t.judgmentId, undefined, (jurisdiction || undefined) as JurisdictionId | undefined);
    return { d, meta: metaOf(d, jurisdiction) };
  } catch (err) {
    throw toUserError(err);
  }
}

function checkChoice(color: string, mode: string): void {
  if (!(HIGHLIGHT_COLORS as readonly string[]).includes(color)) throw new Error('不支援的螢光顏色');
  if (!MODES.includes(mode as AnnotationMode)) throw new Error('不支援的標注模式');
}

export function registerAnnotationIpc(): void {
  ipcMain.handle('annotation:load', async (_e, t: Target & { includeAi?: boolean }) => {
    const { d, meta } = await loadDetail(t);
    const list = await annotations().list(t.judgmentId, d.fullText, meta);
    const includeAi = t.includeAi !== false;
    const shown = list.filter((a) => a.status === 'ok' && (includeAi || a.origin !== 'ai'));
    return {
      meta,
      fullText: d.fullText,
      mainText: d.sections['主文'] ?? '',
      annotations: list,
      /** 只傳位置與顏色，文字由畫面以全文切出（避免重複傳送全文）。 */
      segments: segmentText(d.fullText, shown).map((s) => ({ start: s.start, end: s.end, color: s.color, annotationIds: s.annotationIds })),
      colorLabels: DEFAULT_COLOR_LABELS,
    };
  });

  ipcMain.handle('annotation:add', async (_e, args: Target & { start: number; end: number; color: HighlightColor; mode: AnnotationMode; note?: string }) => {
    checkChoice(args.color, args.mode);
    const { d, meta } = await loadDetail(args);
    return annotations().add(args.judgmentId, meta, {
      judgmentId: args.judgmentId, start: args.start, end: args.end, color: args.color, mode: args.mode, note: args.note ?? '', origin: 'manual',
    }, d.fullText);
  });

  ipcMain.handle('annotation:update', async (_e, args: { judgmentId: string; id: string; patch: { color?: HighlightColor; mode?: AnnotationMode; note?: string } }) => {
    if (args.patch.color !== undefined && !(HIGHLIGHT_COLORS as readonly string[]).includes(args.patch.color)) throw new Error('不支援的螢光顏色');
    if (args.patch.mode !== undefined && !MODES.includes(args.patch.mode)) throw new Error('不支援的標注模式');
    await annotations().update(args.judgmentId, args.id, args.patch);
    return { ok: true };
  });

  ipcMain.handle('annotation:remove', async (_e, args: { judgmentId: string; id: string }) => {
    return { removed: await annotations().remove(args.judgmentId, args.id) };
  });

  ipcMain.handle('annotation:reanchor', async (_e, args: Target & { id: string }) => {
    const { d } = await loadDetail(args);
    const moved: AnnotationView | null = await annotations().reanchor(args.judgmentId, args.id, d.fullText);
    return moved ? { ok: true, annotation: moved } : { ok: false, annotation: null };
  });

  /** AI 引文標注：精讀時驗證過的引文（逐字存在於全文）轉為 origin 為 ai 的螢光標注，與人工標注分開儲存。 */
  ipcMain.handle('annotation:importAi', async (_e, args: Target & { quotes: string[] }) => {
    const { d, meta } = await loadDetail(args);
    const store = annotations();
    const existing = await store.list(args.judgmentId, d.fullText, meta);
    let added = 0, skipped = 0;
    for (const quote of [...new Set(args.quotes ?? [])]) {
      const start = quote ? d.fullText.indexOf(quote) : -1;
      if (start < 0) { skipped++; continue; }
      const end = start + quote.length;
      if (existing.some((a) => a.origin === 'ai' && a.start === start && a.end === end)) { skipped++; continue; }
      await store.add(args.judgmentId, meta, {
        judgmentId: args.judgmentId, start, end, color: 'yellow', mode: 'highlight', origin: 'ai',
      }, d.fullText);
      added++;
    }
    return { added, skipped };
  });

  ipcMain.handle('annotation:judgments', async () => annotations().listJudgments());

  ipcMain.handle('annotation:export', async (_e, t: Target) => {
    const { d, meta } = await loadDetail(t);
    const all = withStatus((await annotations().raw(t.judgmentId))?.annotations ?? [], d.fullText);
    const ok = all.filter((a) => a.status === 'ok');
    const stale = all.filter((a) => a.status !== 'ok');
    const buf = await buildAnnotatedDocx({ meta, fullText: d.fullText }, ok, stale);
    return autoSaveExport(`判決筆記_${(meta.caseNo || t.judgmentId).replace(/[\\/:*?"<>|]/g, '_')}.docx`, buf);
  });

  ipcMain.handle('annotation:syncStatus', async () => syncStatus());
}
