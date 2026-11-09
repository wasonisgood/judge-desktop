// IPC：個案研究筆記（文字區段標注、註解、重新對位、Word 匯出、雲端同步狀態）。
// 判決全文一律經 cachedDetail 取得（快取優先），不另外重新呼叫司法院。
import { ipcMain } from 'electron';
import type { HighlightColor, AnnotationMode, JurisdictionId, JudgmentDetail } from '@judge/core';
import { HIGHLIGHT_COLORS, segmentText } from '@judge/core';
import { buildAnnotatedDocx, buildAnnotatedCasesDocx, type AnnotatedCase } from '../exporters';
import { autoSaveExport, stamp } from '../services/exportService';
import { cachedDetail } from '../data/cloud/courtRepo';
import { annotations } from '../data/local/annotationAccess';
import { withStatus, type JudgmentNoteMeta, type AnnotationView } from '../services/annotationService';
import { syncStatus, buildSyncPayload } from '../services/annotationSync';
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
    const colorLabels = await annotations().getColorLabels();
    return {
      meta,
      fullText: d.fullText,
      mainText: d.sections['主文'] ?? '',
      annotations: list,
      /** 只傳位置與顏色，文字由畫面以全文切出（避免重複傳送全文）。 */
      segments: segmentText(d.fullText, shown).map((s) => ({ start: s.start, end: s.end, color: s.color, annotationIds: s.annotationIds })),
      colorLabels,
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

  /** 單案匯出一律使用目前保存的顏色名稱。 */
  async function caseFor(t: Target): Promise<AnnotatedCase> {
    const { d, meta } = await loadDetail(t);
    const all = withStatus((await annotations().raw(t.judgmentId))?.annotations ?? [], d.fullText);
    return {
      meta,
      fullText: d.fullText,
      annotations: all.filter((a) => a.status === 'ok'),
      stale: all.filter((a) => a.status !== 'ok'),
    };
  }

  ipcMain.handle('annotation:export', async (_e, t: Target) => {
    const c = await caseFor(t);
    const buf = await buildAnnotatedDocx(c, await annotations().getColorLabels());
    return autoSaveExport(`判決筆記_${(c.meta.caseNo || t.judgmentId).replace(/[\\/:*?"<>|]/g, '_')}.docx`, buf);
  });

  /** 多案合併匯出：每案獨立區塊（分頁），依傳入順序排列；任一案無法取得全文時整批中止並說明。 */
  ipcMain.handle('annotation:exportMany', async (_e, args: { targets: Target[] }) => {
    const targets = args.targets ?? [];
    if (targets.length === 0) throw new Error('請先勾選要匯出的案件');
    if (targets.length > 50) throw new Error('一次最多合併 50 案');
    const cases: AnnotatedCase[] = [];
    for (const t of targets) cases.push(await caseFor(t));
    const buf = await buildAnnotatedCasesDocx(cases, await annotations().getColorLabels());
    return autoSaveExport(`判決筆記_合併${cases.length}案_${stamp()}.docx`, buf);
  });

  ipcMain.handle('annotation:labels:get', async () => annotations().getColorLabels());
  ipcMain.handle('annotation:labels:set', async (_e, args: { labels: unknown }) => annotations().setColorLabels(args.labels));

  ipcMain.handle('annotation:syncStatus', async () => syncStatus());
  /** 同步酬載預覽（不送出）：只含標注、註解與判決快照，不含全文。 */
  ipcMain.handle('annotation:syncPreview', async () => {
    const f = await annotations().read();
    return buildSyncPayload(f.judgments, new Date(), await annotations().getColorLabels());
  });
}
