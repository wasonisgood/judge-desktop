// 懸浮 AI 助理的工具執行：查詢類工具直接執行；會花費額度的操作只會列為待確認（見 assistant.ts）。
import type { ToolCall, ToolOutcome, SearchHit, AssistantTurnContext, AssistantPage } from '../assistant';
import { createSearchBudget, runBudgetedSearch } from '@judge/core';
import { newId } from '../library';
import { cachedSearch, cachedDetail } from '../data/cloud/courtRepo';
import { resolveStatute } from '../data/cloud/lawRepo';
import { library } from '../data/local/libraryAccess';
import { checkSetValue, SAVED_ACTIONS, type SavedAction } from '../assistantUi';

export type AssistantPageName = AssistantPage;

// 工具執行。ctx 是本輪對話的共用狀態（搜尋預算與搜尋方式）；未提供時使用單次預算。
export async function executeAssistantTool(call: ToolCall, ctx?: AssistantTurnContext): Promise<ToolOutcome> {
  const input = call.input as Record<string, any>;
  const turn: AssistantTurnContext = ctx ?? { budget: createSearchBudget<SearchHit>(3), searchMode: 'ai', userText: '', page: 'home', controls: new Map() };
  try {
    switch (call.name) {
      case 'search_judgments': {
        // 傳統模式：只用使用者原文搜尋一次（不採用模型改寫的關鍵字）。
        const requested: string[] = turn.searchMode === 'traditional'
          ? [turn.userText]
          : [...(Array.isArray(input.queries) ? input.queries.map(String) : []), ...(input.query ? [String(input.query)] : [])];
        if (requested.every((q) => !q.trim())) return { content: '沒有提供關鍵字。' };
        const r = await runBudgetedSearch<SearchHit>(
          turn.budget,
          requested,
          async (q) => (await cachedSearch(q, 10)).map((it) => ({ id: it.id, title: it.title, date: it.dateIso ?? null, cause: it.cause ?? '' })),
          (h) => h.id,
        );
        const hits = r.items.slice(0, 20);
        return {
          content: JSON.stringify({
            status: r.status,
            searched: r.ran,
            remaining: r.remaining,
            message: r.message,
            hits,
          }),
        };
      }
      case 'resolve_statute': {
        const r = await resolveStatute(String(input.name ?? ''));
        return { content: `正式法名：${r.name}` };
      }
      case 'read_judgment': {
        const d = await cachedDetail(String(input.id ?? ''));
        const main = (d.sections['主文'] ?? '').slice(0, 800);
        const reasoningStart = d.fullText.search(/理\s*由/);
        const reasoning = (reasoningStart >= 0 ? d.fullText.slice(reasoningStart) : d.fullText).slice(0, 6000);
        return { content: JSON.stringify({ title: d.meta.title, court: d.meta.court, date: d.meta.dateIso, cause: d.meta.cause, main, reasoning, fullTextChars: d.fullText.length }) };
      }
      case 'open_page': {
        const page = String(input.page ?? 'home') as AssistantPageName;
        return { content: `已切換到 ${page}。`, navigate: page };
      }
      case 'propose_scope': {
        const statutes = Array.isArray(input.statutes) ? input.statutes.map(String) : [];
        const keyword = String(input.keyword ?? '').trim();
        if (statutes.length === 0 && !keyword) return { content: '沒有提供關鍵字或法規名稱。' };
        const args = {
          statutes,
          keyword,
          relatedStatute: String(input.relatedStatute ?? '').trim(),
          relatedOnly: input.relatedOnly === true,
          smart: input.smart === true,
          yearFrom: input.yearFrom,
          yearTo: input.yearTo,
        };
        return {
          content: '已提議，等待使用者按同意後執行。',
          pending: {
            id: newId(),
            kind: 'run_scope',
            label: `標編碼標注工序：${[...statutes, ...(keyword ? [`關鍵字：${keyword}`] : [])].join('、')}`,
            args,
          },
        };
      }
      case 'propose_brief': {
        const id = String(input.id ?? '');
        if (!id) return { content: '沒有提供判決 id。' };
        return {
          content: '已提議，等待使用者按同意後執行。',
          pending: { id: newId(), kind: 'run_brief', label: `精讀判決：${id}`, args: { judgmentId: id, focus: String(input.focus ?? '') } },
        };
      }
      case 'ui_set': {
        const id = String(input.id ?? '');
        const c = turn.controls.get(id);
        if (!c) return { content: `找不到控制項「${id}」。請只使用控制項目錄中的 id。` };
        const v = checkSetValue(c, input.value);
        if (!v.ok) return { content: v.reason };
        return {
          content: `已設定「${c.label}」（${c.page} 頁）為 ${JSON.stringify(v.value)}，畫面已更新。`,
          ui: { type: 'set', id, value: v.value },
        };
      }
      case 'ui_click': {
        const id = String(input.id ?? '');
        const c = turn.controls.get(id);
        if (!c) return { content: `找不到控制項「${id}」。請只使用控制項目錄中的 id。` };
        if (c.kind !== 'button') return { content: `「${c.label}」不是按鈕，請用 ui_set 設定值。` };
        if (c.disabled) return { content: `「${c.label}」目前是停用狀態，無法按下。` };
        return {
          content: '已提議按下，等待使用者按同意後執行。',
          pending: { id: newId(), kind: 'ui_click', label: `按下「${c.label}」（${c.page} 頁）`, args: { id } },
        };
      }
      case 'list_saved': {
        const status = ['active', 'archived', 'trashed'].includes(String(input.status)) ? (input.status as 'active' | 'archived' | 'trashed') : undefined;
        const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 50);
        const all = await library().list(status);
        const rows = all.slice(0, limit).map((it) => ({
          id: it.id, kind: it.kind, title: it.title, summary: it.summary, starred: it.starred, status: it.status,
        }));
        return { content: JSON.stringify({ total: all.length, items: rows }) };
      }
      case 'open_saved': {
        const id = String(input.id ?? '');
        const it = (await library().list()).find((x) => x.id === id);
        if (!it) return { content: `找不到已保存的項目「${id}」。請先用 list_saved 查找。` };
        return { content: `已開啟「${it.title}」。`, navigate: 'files', ui: { type: 'openSaved', id } };
      }
      case 'saved_action': {
        const id = String(input.id ?? '');
        const action = String(input.action ?? '') as SavedAction;
        if (!(action in SAVED_ACTIONS)) return { content: `不支援的整理動作：${action}` };
        const it = (await library().list()).find((x) => x.id === id);
        if (!it) return { content: `找不到已保存的項目「${id}」。` };
        return {
          content: '已提議，等待使用者按同意後執行。',
          pending: { id: newId(), kind: 'saved_action', label: `${SAVED_ACTIONS[action]}「${it.title}」`, args: { id, action } },
        };
      }
      default:
        return { content: `不支援的工具：${call.name}` };
    }
  } catch (err) {
    return { content: `執行失敗：${err instanceof Error ? err.message : String(err)}` };
  }
}
