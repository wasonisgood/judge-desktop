// IPC：判決列表（檢索、AI 相關性篩選、匯出）與單一判決的候選查找（v3.6.0：可取消、部分結果保留、存檔失敗回報）。
import { ipcMain } from 'electron';
import {
  screenRelevance, judgmentQueries, parseManualJudgmentIds, DEFAULT_JURISDICTION_ID, type RelevanceItem, type JudgmentDetail, type JudgmentSummary,
  runQueryRounds, proposeQueries, newTrace, addStep, explainTrace, type AiComplete, raceAbort,
} from '@judge/core';
import { buildListWorkbook } from '../exporters';
import { cachedSearch, cachedDetail } from '../data/cloud/courtRepo';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { autoSaveExport, stamp } from '../services/exportService';
import { lawContextForStatute } from '../services/lawContext';
import { withJob } from '../services/jobRegistry';
import { safeSend } from '../services/safeSend';
import { saveToLibrary } from '../services/savedResult';
import { toUserError } from '../services/userError';

const SMART_MAX_ROUNDS = 3;

type DetailMap = Record<string, Pick<JudgmentDetail, 'meta' | 'sections' | 'fullText'> & { historyPosition: string }>;

export function registerSearchIpc(): void {
  ipcMain.handle('search:screen', (_e, args: { runId: string; topic: string; items: RelevanceItem[]; ai?: string }) =>
    withJob(args.runId, 'search', `AI 篩選：${args.topic}`, async (signal) => {
      try {
        const ai = await requireAi(normalizeAiMode(args.ai), signal);
        return await screenRelevance(ai, args.topic, args.items.slice(0, 40));
      } catch (err) {
        throw toUserError(err);
      }
    }));

  ipcMain.handle('search:run', (e, args: { runId: string; keyword: string; courtCode?: string; maxItems: number; includeFullText: boolean; jurisdiction?: string }) =>
    withJob(args.runId, 'search', `判決列表：${args.keyword}`, async (signal) => {
      let items: JudgmentSummary[];
      try {
        items = await cachedSearch(args.keyword, args.maxItems, args.courtCode, args.jurisdiction);
      } catch (err) {
        throw toUserError(err);
      }
      const details: DetailMap = {};
      const notes: string[] = [];
      if (args.includeFullText) {
        let i = 0;
        for (const it of items) {
          if (signal.aborted) break;
          i++;
          safeSend(e.sender, 'search:progress', { done: i, total: items.length, id: it.id });
          try {
            const d = await cachedDetail(it.id, undefined, args.jurisdiction);
            details[it.id] = { meta: d.meta, sections: d.sections, fullText: d.fullText, historyPosition: d.historyPosition?.summary ?? '' };
          } catch (err) {
            notes.push(`${it.id}：${toUserError(err).message}`);
          }
        }
      }
      const save = await saveToLibrary({
        kind: 'list',
        title: `判決列表：${args.keyword}`,
        summary: `${items.length} 筆${args.includeFullText ? '（含全文）' : ''}${signal.aborted ? '（已取消，部分結果）' : ''}`,
        payload: { keyword: args.keyword, items, details },
      });
      return { items, details, notes, cancelled: signal.aborted, saveError: save.saveError };
    }));

  ipcMain.handle('export:list', async (_e, args: { keyword: string; items: JudgmentSummary[]; details: Record<string, any> }) => {
    return autoSaveExport(`判決列表_${args.keyword}_${stamp()}.xlsx`, await buildListWorkbook({ keyword: args.keyword, items: args.items, details: args.details }));
  });

  // 手動輸入判決：每行一則（網址或 ID）。逐則取得基本資料（單則失敗只記錄），可取消，部分結果仍保留。
  ipcMain.handle('search:manual', (e, args: { runId: string; text: string; jurisdiction?: string }) =>
    withJob(args.runId, 'search', '手動輸入判決', async (signal) => {
      const parsed = parseManualJudgmentIds(args.text ?? '');
      const items: JudgmentSummary[] = [];
      const details: DetailMap = {};
      const notes: string[] = parsed.invalid.map((line) => `無法辨識：${line}`);
      let i = 0;
      for (const id of parsed.ids) {
        if (signal.aborted) break;
        i++;
        safeSend(e.sender, 'search:progress', { done: i, total: parsed.ids.length, id });
        try {
          const d = await cachedDetail(id, undefined, args.jurisdiction);
          items.push({
            id,
            title: d.meta.title || id,
            dateDisplay: d.meta.dateMinguo ?? d.meta.dateIso ?? '',
            dateIso: d.meta.dateIso ?? null,
            cause: d.meta.cause ?? '',
            href: d.meta.sourceUrl,
          });
          details[id] = { meta: d.meta, sections: d.sections, fullText: d.fullText, historyPosition: d.historyPosition?.summary ?? '' };
        } catch (err) {
          notes.push(`${id}：${toUserError(err).message}`);
        }
      }
      const save = await saveToLibrary({
        kind: 'list',
        title: '手動輸入判決列表',
        summary: `${items.length} 筆${signal.aborted ? '（已取消，部分結果）' : ''}`,
        payload: { keyword: '手動輸入', items, details },
      });
      return { items, details, notes, cancelled: signal.aborted, saveError: save.saveError };
    }));

  // 智慧搜尋：有上限的關鍵字輪次。可取消（保留已找到的結果）；AI 提議失敗不吃掉結果；未設定 AI 時退回傳統搜尋。
  ipcMain.handle('search:smart', (_e, args: { runId: string; request: string; statute?: string; jurisdiction?: string; maxItems?: number; ai?: string }) =>
    withJob(args.runId, 'search', `智慧搜尋：${args.request}`, async (signal) => {
      const request = String(args.request ?? '').trim();
      const trace = newTrace('判決列表');
      if (!request) return { status: 'done' as const, items: [], tried: [], notes: [], cancelled: false, saveError: null, explanation: explainTrace(trace) };
      const notes: string[] = [];
      let ai: AiComplete | null = null;
      try {
        ai = await requireAi(normalizeAiMode(args.ai), signal);
      } catch (err) {
        addStep(trace, { stage: 'AI 設定', module: 'rule', input: request, output: '未使用 AI', decision: 'skip', reason: toUserError(err).message });
      }
      const maxItems = args.maxItems ?? 20;
      let lawContext: string | undefined;
      const statute = String(args.statute ?? '').trim();
      if (statute) {
        const lc = await lawContextForStatute(statute);
        if (lc.text) lawContext = lc.text;
        notes.push(...lc.notes);
        addStep(trace, {
          stage: '讀入法規現行條文與沿革', module: 'rule', input: statute,
          output: lc.text ? '已讀入' : '未取得', decision: 'pass', reason: lc.notes.length ? lc.notes.join('；') : '法規內容已交給 AI 提議關鍵字',
        });
      }
      const result = await runQueryRounds<JudgmentSummary>({
        feature: '判決搜尋',
        trace,
        module: ai ? 'ai' : 'rule',
        initialQueries: [request],
        maxRounds: SMART_MAX_ROUNDS,
        signal,
        search: (q) => cachedSearch(q, maxItems, undefined, args.jurisdiction),
        keyOf: (it) => it.id,
        onError: (q, err) => notes.push(`搜尋「${q}」失敗：${toUserError(err).message}`),
        onProposeError: (err) => notes.push(`AI 無法提議新關鍵字：${toUserError(err).message}`),
        propose: async ({ tried, kept, round }) => {
          if (!ai) return { unclear: false, queries: [], reason: '未設定 AI，無法自動調整關鍵字' };
          return raceAbort(proposeQueries(ai, { request, tried, keptCount: kept.length, round, lawContext }), signal);
        },
      });
      const save = result.items.length
        ? await saveToLibrary({
          kind: 'list',
          title: `判決列表：${request}`,
          summary: `${result.items.length} 筆（智慧搜尋）${result.status === 'cancelled' ? '，已取消' : ''}`,
          payload: { keyword: request, items: result.items, details: {} },
        })
        : { saveError: null };
      const explanation = explainTrace(trace);
      const base = { items: result.items, tried: result.tried, notes, cancelled: result.status === 'cancelled', saveError: save.saveError, explanation };
      if (result.status === 'ask') return { status: 'ask' as const, ...base, question: result.question, options: result.options };
      if (result.status === 'capped') return { status: 'capped' as const, ...base, advice: result.advice };
      return { status: 'done' as const, ...base };
    }));

  // 單一判決：先搜尋、列出候選，再由使用者指定一則（鎖定單一判決）。快速查詢，不登記為長時間工作。
  ipcMain.handle('judgment:find', async (_e, args: { query: string; jurisdiction?: string }) => {
    const seen = new Map<string, JudgmentSummary>();
    let note = '';
    // 縮寫展開（例如「高院」→「臺灣高等法院」）只適用於台灣司法院；其他管轄區照原字串查詢。
    const isTw = !args.jurisdiction || args.jurisdiction === DEFAULT_JURISDICTION_ID;
    const queries = isTw ? judgmentQueries(args.query) : [args.query.trim()];
    for (const q of queries) {
      try {
        for (const it of await cachedSearch(q, 20, undefined, args.jurisdiction)) if (!seen.has(it.id)) seen.set(it.id, it);
      } catch (err) {
        // 查無結果或暫時被限制查詢：不中斷，回報說明即可
        const msg = err instanceof Error ? err.message : String(err);
        note = /查無|風控/.test(msg) ? '司法院網站沒有查到結果，或暫時限制查詢，請稍後再試或換關鍵字。' : toUserError(err).message;
      }
    }
    return { items: [...seen.values()].slice(0, 30), note };
  });
}
