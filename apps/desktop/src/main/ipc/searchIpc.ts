// IPC：判決列表（檢索、AI 相關性篩選、匯出）與單一判決的候選查找。
import { ipcMain } from 'electron';
import {
  screenRelevance, judgmentQueries, parseManualJudgmentIds, DEFAULT_JURISDICTION_ID, type RelevanceItem, type JudgmentDetail, type JudgmentSummary,
  runQueryRounds, proposeQueries, newTrace, addStep, explainTrace, type AiComplete,
} from '@judge/core';

const SMART_MAX_ROUNDS = 3;
import { buildListWorkbook } from '../exporters';
import { cachedSearch, cachedDetail } from '../data/cloud/courtRepo';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { library } from '../data/local/libraryAccess';
import { autoSaveExport, stamp } from '../services/exportService';
import { lawContextForStatute } from '../services/lawContext';

export function registerSearchIpc(): void {
  ipcMain.handle('search:screen', async (_e, args: { topic: string; items: RelevanceItem[]; ai?: string }) => {
    const ai = await requireAi(normalizeAiMode(args.ai));
    return screenRelevance(ai, args.topic, args.items.slice(0, 40));
  });
  ipcMain.handle('search:run', async (e, args: { keyword: string; courtCode?: string; maxItems: number; includeFullText: boolean; jurisdiction?: string }) => {
    const items = await cachedSearch(args.keyword, args.maxItems, args.courtCode, args.jurisdiction);
    const details: Record<string, Pick<JudgmentDetail, 'meta' | 'sections' | 'fullText'> & { historyPosition: string }> = {};
    if (args.includeFullText) {
      let i = 0;
      for (const it of items) {
        i++;
        e.sender.send('search:progress', { done: i, total: items.length, id: it.id });
        const d = await cachedDetail(it.id, undefined, args.jurisdiction);
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
  // 手動輸入判決：每行一則（網址或 ID）。逐則取得基本資料，產生與搜尋相同格式的列表，並存入檔案管理。
  ipcMain.handle('search:manual', async (e, args: { text: string; jurisdiction?: string }) => {
    const parsed = parseManualJudgmentIds(args.text ?? '');
    const items: JudgmentSummary[] = [];
    const details: Record<string, Pick<JudgmentDetail, 'meta' | 'sections' | 'fullText'> & { historyPosition: string }> = {};
    const notes: string[] = parsed.invalid.map((line) => `無法辨識：${line}`);
    let i = 0;
    for (const id of parsed.ids) {
      i++;
      e.sender.send('search:progress', { done: i, total: parsed.ids.length, id });
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
        notes.push(`${id}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await library().add({
      kind: 'list',
      title: '手動輸入判決列表',
      summary: `${items.length} 筆`,
      payload: { keyword: '手動輸入', items, details },
    });
    return { items, details, notes };
  });
  // 智慧搜尋（issue #4）：有上限的查詢輪次。未設定 AI 時退回傳統搜尋（只查一次）。
  // 語意不清時回傳選項；使用者選擇後，畫面以選項文字重新呼叫。流程紀錄隨結果回傳，供說明視窗使用。
  ipcMain.handle('search:smart', async (_e, args: { request: string; statute?: string; jurisdiction?: string; maxItems?: number; ai?: string }) => {
    const request = String(args.request ?? '').trim();
    const trace = newTrace('判決列表');
    if (!request) return { status: 'done', items: [], tried: [], explanation: explainTrace(trace) };
    let ai: AiComplete | null = null;
    try {
      ai = await requireAi(normalizeAiMode(args.ai));
    } catch (err) {
      addStep(trace, { stage: 'AI 設定', module: 'rule', input: request, output: '未使用 AI', decision: 'skip', reason: err instanceof Error ? err.message : String(err) });
    }
    const maxItems = args.maxItems ?? 20;
    // 法規上下文（issue #4 第 4 點）：有指定相關法規時，AI 提議關鍵字前先讀入現行條文與沿革。
    let lawContext: string | undefined;
    const statute = String(args.statute ?? '').trim();
    if (statute) {
      const lc = await lawContextForStatute(statute);
      if (lc.text) lawContext = lc.text;
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
      search: (q) => cachedSearch(q, maxItems, undefined, args.jurisdiction),
      keyOf: (it) => it.id,
      onError: () => { /* 單一關鍵字失敗已記錄在流程中，其餘關鍵字照常 */ },
      propose: async ({ tried, kept, round }) => {
        if (!ai) return { unclear: false, queries: [], reason: '未設定 AI，無法自動調整關鍵字' };
        return proposeQueries(ai, { request, tried, keptCount: kept.length, round, lawContext });
      },
    });
    if (result.items.length) {
      await library().add({
        kind: 'list',
        title: `判決列表：${request}`,
        summary: `${result.items.length} 筆（智慧搜尋）`,
        payload: { keyword: request, items: result.items, details: {} },
      });
    }
    const explanation = explainTrace(trace);
    if (result.status === 'ask') return { status: 'ask', items: result.items, tried: result.tried, question: result.question, options: result.options, explanation };
    if (result.status === 'capped') return { status: 'capped', items: result.items, tried: result.tried, advice: result.advice, explanation };
    return { status: 'done', items: result.items, tried: result.tried, explanation };
  });
  // 單一判決：先搜尋、列出候選，再由使用者指定一則（鎖定單一判決）
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
        note = /查無|風控/.test(msg) ? '司法院網站沒有查到結果，或暫時限制查詢，請稍後再試或換關鍵字。' : msg;
      }
    }
    return { items: [...seen.values()].slice(0, 30), note };
  });
}
