// 懸浮 AI 助理的工具執行：查詢類工具直接執行；會花費額度的操作只會列為待確認（見 assistant.ts）。
import type { ToolCall, ToolOutcome, SearchHit } from '../assistant';
import { mergeSearchHits } from '../assistant';
import { newId } from '../library';
import { cachedSearch, cachedDetail } from '../data/cloud/courtRepo';
import { resolveStatute } from '../data/cloud/lawRepo';

export type AssistantPageName = 'home' | 'list' | 'scope' | 'brief' | 'files' | 'settings';

export async function executeAssistantTool(call: ToolCall): Promise<ToolOutcome> {
  const input = call.input as Record<string, any>;
  try {
    switch (call.name) {
      case 'search_judgments': {
        const list: string[] = Array.isArray(input.queries) ? input.queries.map(String) : [];
        if (input.query) list.push(String(input.query));
        const queries = [...new Set(list.map((q) => q.trim()).filter(Boolean))].slice(0, 4);
        if (queries.length === 0) return { content: '沒有提供關鍵字。' };
        const groups: SearchHit[][] = [];
        for (const q of queries) {
          const items = await cachedSearch(q, 10);
          groups.push(items.map((it) => ({ id: it.id, title: it.title, date: it.dateIso ?? null, cause: it.cause ?? '' })));
        }
        const merged = mergeSearchHits(groups, 20);
        return { content: merged.length ? JSON.stringify({ queries, hits: merged }) : '查無符合的判決。' };
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
        if (statutes.length === 0) return { content: '沒有提供法規名稱。' };
        return {
          content: '已提議，等待使用者按同意後執行。',
          pending: {
            id: newId(),
            kind: 'run_scope',
            label: `範圍整理：${statutes.join('、')}`,
            args: { statutes, yearFrom: input.yearFrom, yearTo: input.yearTo },
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
