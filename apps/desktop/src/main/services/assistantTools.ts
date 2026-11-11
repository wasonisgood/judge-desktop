// 懸浮 AI 助理的工具執行：查詢類工具直接執行；會花費額度的操作只會列為待確認（見 assistant.ts）。
import type { ToolCall, ToolOutcome, SearchHit, AssistantTurnContext, AssistantPage } from '../assistant';
import { createSearchBudget, runBudgetedSearch } from '@judge/core';
import { newId } from '../library';
import { cachedSearch, cachedDetail } from '../data/cloud/courtRepo';
import { resolveStatute } from '../data/cloud/lawRepo';

export type AssistantPageName = AssistantPage;

// 工具執行。ctx 是本輪對話的共用狀態（搜尋預算與搜尋方式）；未提供時使用單次預算。
export async function executeAssistantTool(call: ToolCall, ctx?: AssistantTurnContext): Promise<ToolOutcome> {
  const input = call.input as Record<string, any>;
  const turn: AssistantTurnContext = ctx ?? { budget: createSearchBudget<SearchHit>(3), searchMode: 'ai', userText: '' };
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
      default:
        return { content: `不支援的工具：${call.name}` };
    }
  } catch (err) {
    return { content: `執行失敗：${err instanceof Error ? err.message : String(err)}` };
  }
}
