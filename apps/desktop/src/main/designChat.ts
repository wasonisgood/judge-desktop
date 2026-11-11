// 研究設計對話（主程序）：AI 是獨立的多輪對話助理，協助把問題意識凝練成可以用判決實證的研究題目。
// 畫面上的按鈕對應成工具，AI 可以呼叫：寫入欄位、試搜尋判決數、帶入範圍整理。
// 原則：
// 1. 只寫入使用者說過的內容（set_fields），不猜測。
// 2. 試搜尋只回傳筆數與前幾筆標題，不保存、不讀全文；每輪最多 3 次。
// 3. 會切換頁面的動作（hand_off_scope）只回傳導向，由畫面決定如何帶入。
import { newSession, type DesignSession } from '@judge/core';
import { runToolLoop, type AssistantPage, type Item, type ToolDef, type ToolOutcome } from './assistant';
import type { AiConfig } from './ai';
import { applyFieldEdits, FIELD_KEYS, type StoredDesign } from './designSession';

/** 每一輪對話的試搜尋上限。 */
export const DESIGN_SEARCH_MAX = 3;

export const DESIGN_TOOLS: ToolDef[] = [
  {
    name: 'set_fields',
    description: '把使用者已經明確提到的研究設計欄位寫入表單。只填使用者說過的內容；年份用西元整數；沒有提到的欄位不要傳。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '可實證的研究問題（一句話）' },
        subject: { type: 'string', description: '研究對象' },
        variable: { type: 'string', description: '要比較或觀察的變項' },
        yearFrom: { type: 'integer', description: '期間起始年（西元）' },
        yearTo: { type: 'integer', description: '期間結束年（西元）' },
        statute: { type: 'string', description: '法規名稱與條號，例如「消費者保護法第7條」' },
        caseType: { type: 'string', description: '民事、刑事或行政' },
        courtLevel: { type: 'string', description: '地方法院、高等法院或最高法院' },
      },
    },
  },
  {
    name: 'search_preview',
    description: '試搜尋司法院判決，只回傳筆數與前幾筆標題（不保存、不讀全文），用來判斷題目是否有足夠的判決可以研究。每一輪最多 3 次。',
    parameters: {
      type: 'object',
      properties: { queries: { type: 'array', items: { type: 'string' }, description: '1 到 3 組關鍵字' } },
      required: ['queries'],
    },
  },
  {
    name: 'hand_off_scope',
    description: '把目前的法規與期間帶入「標編碼標注工序」頁（會切換頁面）。需要先填寫法規。',
    parameters: { type: 'object', properties: {} },
  },
];

const SYSTEM_PROMPT = [
  '你是「司法院裁判研究」的研究設計助理。使用者會用口語描述想研究的問題。',
  '你的任務是與使用者多輪對話，把模糊的問題意識凝練成可以用司法院判決實證回答的研究題目，並選定研究對象、變項、法規、期間、案件類型與法院層級。',
  '原則：',
  '1. 每次只問一個最關鍵的問題，並簡短說明為什麼要問。',
  '2. 使用者明確說過的內容才用 set_fields 寫入欄位；沒有說過的不要猜，也不要編造。',
  '3. 題目要能由判決原文回答。若判決無法回答（例如需要全體案件的統計或非判決資料），直接說明。',
  `4. 需要確認判決數量時用 search_preview（每輪最多 ${DESIGN_SEARCH_MAX} 次），根據筆數建議放寬或收窄關鍵字與期間。`,
  '5. 欄位大致定案後，可用 hand_off_scope 帶入標編碼標注工序。',
  '6. 使用繁體中文（台灣用語），簡潔平實，不使用表情符號。查不到的判決就說查不到，不得編造判決字號。',
].join('\n');

/** 試搜尋的注入點（畫面與測試各自提供；主程序用 courtRepo 的 cachedSearch）。 */
export type DesignSearch = (query: string, limit: number) => Promise<{ title: string }[]>;

export interface DesignDeps {
  config: AiConfig;
  search: DesignSearch;
}

export interface DesignChatResult {
  reply: string;
  /** 本輪由 AI 執行的動作摘要（給畫面顯示）。 */
  actions: string[];
  /** 需要切換的頁面（目前只有 scope）。 */
  navigate: AssistantPage | null;
}

/** 產生新的研究設計（第一句話即問題意識）。 */
export function createSession(text: string, now: Date = new Date()): DesignSession {
  const problem = text.trim();
  if (!problem) throw new Error('請先輸入你的問題意識（可以很模糊）');
  return newSession(problem, now);
}

function fieldsOf(session: DesignSession): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) {
    const v = (session.slots as unknown as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/** 一輪對話：把使用者的話加入紀錄，執行工具迴圈，最後寫回 AI 的回覆。 */
export async function runDesignTurn(
  deps: DesignDeps,
  entry: StoredDesign,
  userText: string,
  signal?: AbortSignal,
  now: Date = new Date(),
): Promise<{ entry: StoredDesign; result: DesignChatResult }> {
  const text = userText.trim();
  if (!text) throw new Error('請輸入內容再送出');
  let session = entry.session;
  const stamp = now.toISOString();
  session = { ...session, turns: [...session.turns, { role: 'user', text, at: stamp }], updatedAt: stamp };

  const actions: string[] = [];
  let navigate: AssistantPage | null = null;
  let searches = 0;

  const execute = async (call: { name: string; input: Record<string, unknown> }): Promise<ToolOutcome> => {
    try {
      switch (call.name) {
        case 'set_fields': {
          const before = fieldsOf(session);
          session = applyFieldEdits(session, call.input, now);
          const after = fieldsOf(session);
          const changed = FIELD_KEYS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
          if (changed.length) actions.push(`已寫入欄位：${changed.join('、')}`);
          return { content: JSON.stringify({ ok: true, fields: after }) };
        }
        case 'search_preview': {
          if (searches >= DESIGN_SEARCH_MAX) return { content: `本輪試搜尋已達 ${DESIGN_SEARCH_MAX} 次上限，請依現有結果回答。` };
          searches += 1;
          const queries = Array.isArray(call.input.queries) ? call.input.queries.map(String).filter((q) => q.trim()).slice(0, 3) : [];
          if (queries.length === 0) return { content: '沒有提供關鍵字。' };
          const rows = [];
          for (const q of queries) {
            const hits = await deps.search(q, 10);
            rows.push({ query: q, count: hits.length, titles: hits.slice(0, 3).map((h) => h.title) });
          }
          actions.push(`試搜尋：${queries.join('、')}`);
          return { content: JSON.stringify({ searched: searches, remaining: DESIGN_SEARCH_MAX - searches, rows }) };
        }
        case 'hand_off_scope': {
          if (!session.slots.statute) return { content: '尚未填寫法規，無法帶入範圍整理。請先請使用者提供法規名稱。' };
          navigate = 'scope';
          actions.push('已帶入標編碼標注工序');
          return { content: '已帶入法規與期間，頁面即將切換。' };
        }
        default:
          return { content: `不支援的工具：${call.name}` };
      }
    } catch (err) {
      return { content: `執行失敗：${err instanceof Error ? err.message : String(err)}` };
    }
  };

  // 歷史紀錄轉成模型格式（最近 20 則）；最後一則是本輪使用者的話。
  const items: Item[] = session.turns.slice(-20).map((t): Item =>
    (t.role === 'user' ? { type: 'user', text: t.text } : { type: 'assistant', text: t.text, calls: [] }));
  const reply = await runToolLoop(deps.config, SYSTEM_PROMPT, DESIGN_TOOLS, items, execute, signal);

  const guideText = actions.length ? `（${actions.join('；')}）\n${reply}` : reply;
  session = { ...session, turns: [...session.turns, { role: 'guide', text: guideText, at: new Date().toISOString() }], updatedAt: new Date().toISOString() };
  return { entry: { ...entry, session }, result: { reply, actions, navigate } };
}
