// 懸浮 AI 助理（主程序）：以工具呼叫（tool use）理解使用者的需求，並透過應用程式既有的流程操作。
// 原則：
// 1. 查詢類工具（搜尋判決、確認法名、讀取判決摘要）可直接執行，結果回給模型。
// 2. 會花費 AI 額度或會改動資料的操作（範圍整理、單一判決精讀、封存、刪除），一律先列為「待確認」，
//    由使用者在畫面上按同意後才執行；模型本身不能直接執行這些操作。
// 3. 金鑰只在主程序使用，不會傳給畫面。
import { anthropicAuthHeaders, type AiConfig } from './ai';
import { createSearchBudget, type SearchBudget, JobCancelledError, raceAbort } from '@judge/core';
import { sanitizeControls, controlMap, controlsPrompt, type UiAction, type UiControl } from './assistantUi';
export type { UiAction, UiControl } from './assistantUi';

/** 搜尋方式（issue #4 第 5、6 點）：AI 協助（模型改寫與擴充關鍵字）或傳統（使用者原文，只搜一次）。 */
export type AssistantSearchMode = 'ai' | 'traditional';

/** 每一輪對話的搜尋預算：最多 3 次搜尋，結果跨次保留。 */
export const ASSISTANT_SEARCH_MAX = 3;

/** 一輪對話中工具可共用的狀態。 */
export interface AssistantTurnContext {
  budget: SearchBudget<SearchHit>;
  searchMode: AssistantSearchMode;
  /** 使用者本輪的原文（傳統模式下直接拿來搜尋）。 */
  userText: string;
  /** 目前頁面與全部頁面的控制項目錄（以 id 驗證模型要操作的控制項）。 */
  page: string;
  controls: Map<string, UiControl>;
}

export const ASSISTANT_PAGES = ['home', 'design', 'list', 'semantic', 'scope', 'criteria', 'brief', 'chart', 'files', 'tools', 'crawl', 'settings'] as const;
export type AssistantPage = typeof ASSISTANT_PAGES[number];

export interface PendingAction {
  id: string;
  label: string;
  kind: 'run_scope' | 'run_brief' | 'ui_click' | 'saved_action';
  args: Record<string, unknown>;
}

export interface AssistantTurn {
  reply: string;
  navigate: AssistantPage | null;
  pending: PendingAction[];
  /** 立即執行的畫面動作（依順序）：設定欄位值、打開檔案項目。 */
  ui: UiAction[];
}

/** 內部對話紀錄（與供應商無關），送出前再轉成各家的格式。 */
export type Item =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string; calls: ToolCall[] }
  | { type: 'tool'; id: string; name: string; content: string };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 工具的執行結果：content 回給模型；pending 是要使用者確認的動作；navigate 是要切換的頁面。 */
export interface ToolOutcome {
  content: string;
  pending?: PendingAction;
  navigate?: AssistantPage;
  ui?: UiAction;
}

export const ASSISTANT_TOOLS: ToolDef[] = [
  {
    name: 'search_judgments',
    description: '依關鍵字搜尋司法院裁判書，回傳候選判決（字號、日期、案由）。可一次給多組關鍵字（同義詞、案由、法名、相關條文），結果會合併去重。只搜尋，不會改動資料。',
    parameters: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: '多組關鍵字，建議 2 到 4 組，例如案由、同義詞、法名' },
        query: { type: 'string', description: '單一關鍵字（與 queries 擇一即可）' },
      },
    },
  },
  {
    name: 'resolve_statute',
    description: '確認法規的正式名稱（全國法規資料庫）。使用者說的法名不完整或有錯字時使用。',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'read_judgment',
    description: '讀取一則判決的字號、法院、日期與主文摘要（不呼叫 AI）。',
    parameters: { type: 'object', properties: { id: { type: 'string', description: '判決 id' } }, required: ['id'] },
  },
  {
    name: 'open_page',
    description: '切換到應用程式的某一頁。',
    parameters: {
      type: 'object',
      properties: { page: { type: 'string', enum: [...ASSISTANT_PAGES] } },
      required: ['page'],
    },
  },
  {
    name: 'propose_scope',
    description: '提議執行標編碼標注工序（範圍整理，會呼叫 AI，需使用者確認）。可用兩種輸入，至少給一種：keyword 為自然語言關鍵字（可搭配 smart 智慧搜尋、relatedStatute 相關法規、relatedOnly 只保留引用相關法規的判決）；statutes 每行一部法規，可含條項款，例如「民法第184條第1項」。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        smart: { type: 'boolean' },
        relatedStatute: { type: 'string' },
        relatedOnly: { type: 'boolean' },
        statutes: { type: 'array', items: { type: 'string' } },
        yearFrom: { type: 'integer' },
        yearTo: { type: 'integer' },
      },
    },
  },
  {
    name: 'propose_brief',
    description: '提議對一則判決做 AI 精讀（會呼叫 AI，需使用者確認）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, focus: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'ui_set',
    description: '在畫面上設定一個輸入欄位、下拉選單或勾選框的值（會立即更新畫面，不會執行任何搜尋或 AI 操作）。id 必須來自「控制項目錄」；敏感欄位不能填寫；按鈕請用 ui_click。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '控制項 id' },
        value: { description: '要設定的值：文字、數字、或 true／false（勾選框）' },
      },
      required: ['id', 'value'],
    },
  },
  {
    name: 'ui_click',
    description: '提議按下畫面上的一個按鈕（例如搜尋、執行、儲存、清除）。按鈕可能會呼叫 AI 或改動資料，因此一律需要使用者按同意後才執行。id 必須來自「控制項目錄」的按鈕。',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_saved',
    description: '列出「檔案」中已保存的結果（id、類別、標題、摘要、是否加星號、狀態）。用來找出要開啟或整理的項目。',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'archived', 'trashed'] }, limit: { type: 'integer' } },
    },
  },
  {
    name: 'open_saved',
    description: '切換到「檔案」頁並開啟指定的已保存結果（會還原該結果的畫面）。',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'saved_action',
    description: '提議對已保存的結果做整理動作：加／取消星號、封存、移回使用中、移入垃圾桶、還原、或永久刪除。需要使用者按同意後才執行。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        action: { type: 'string', enum: ['star', 'unstar', 'archive', 'unarchive', 'trash', 'restore', 'delete'] },
      },
      required: ['id', 'action'],
    },
  },
];

const SYSTEM_PROMPT_BASE = [
  '你是「司法院裁判研究」桌面應用程式的助理。使用繁體中文（台灣用語），語氣簡潔平實，不使用表情符號。',
  '你可以用工具查詢判決與法規，也可以提議操作應用程式的功能。',
  '會呼叫 AI 或改動資料的操作，只能用 propose_ 開頭的工具提議，由使用者確認後才會執行；按按鈕（ui_click）與檔案整理（saved_action）也一樣，需使用者同意。',
  '你可以操作應用程式的每一個頁面：下方「控制項目錄」列出各頁的欄位與按鈕（id、標籤、目前值、選項）。要切換頁面用 open_page；用 ui_set 設定欄位值（立即更新畫面）；用 ui_click 提議按下按鈕。需要時先切換到該頁。',
  '控制項的 id 必須來自目錄，不要猜。敏感欄位（金鑰、密碼、權杖）不能填寫，請告訴使用者自行輸入。',
  '檔案頁的項目用 list_saved 查找，open_saved 開啟；加星號、封存、移入垃圾桶、刪除等整理動作用 saved_action 提議。',
  '提議標編碼標注工序（propose_scope）時，關鍵字與法規清單可以單獨使用，也可以併用；使用者只說一句話描述範圍時請用 keyword。',
  '搜尋判決時，請把同義詞、案由、法名拆成 2 到 4 組關鍵字一起搜尋（用 queries），不要只用一個詞。',
  `每一輪對話最多搜尋 ${ASSISTANT_SEARCH_MAX} 次。工具回傳的「剩餘次數」與「目前保留筆數」會告訴你狀況：結果不足就換不同的關鍵字補搜；已達上限就停止搜尋，依目前保留的結果回答，說明狀況與解方，並詢問使用者是否同意新方向。`,
  '若使用者的需求語意不清（例如同一個詞可能指兩種法律領域），不要猜：請列出 2 到 3 個候選解讀，並把「自行輸入更正後再試」放在最後一項，請使用者選擇。',
  '只在使用者明確要求時才呼叫工具；不要為了「順便」再搜尋或重複執行先前已完成的查詢。回覆只說明與使用者要求有關的內容，不要提及自己沒有被要求的動作。',
  '不確定使用者要什麼時，先問清楚，不要猜。不得編造判決字號或法條內容；查不到就說查不到。',
].join('\n');

const SYSTEM_PROMPT_TRADITIONAL = '傳統搜尋模式：搜尋判決時只使用使用者的原文作為關鍵字，只搜尋一次，不要自行改寫或擴充關鍵字。';

function systemPromptFor(mode: AssistantSearchMode, page: string, controls: Map<string, UiControl>): string {
  const catalog = controls.size ? '\n\n控制項目錄：\n' + controlsPrompt(Array.from(controls.values()), page) : '';
  return [SYSTEM_PROMPT_BASE, mode === 'traditional' ? SYSTEM_PROMPT_TRADITIONAL : ''].filter(Boolean).join('\n') + catalog;
}

// ---------------------------------------------------------------------------
// 供應商格式轉換
// ---------------------------------------------------------------------------
function toAnthropic(items: Item[]): unknown[] {
  const out: any[] = [];
  for (const it of items) {
    if (it.type === 'user') out.push({ role: 'user', content: it.text });
    else if (it.type === 'assistant') {
      const content: any[] = [];
      if (it.text) content.push({ type: 'text', text: it.text });
      for (const c of it.calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '（無）' }] });
    } else {
      const block = { type: 'tool_result', tool_use_id: it.id, content: it.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

function toOpenAi(items: Item[]): unknown[] {
  const out: any[] = [];
  for (const it of items) {
    if (it.type === 'user') out.push({ role: 'user', content: it.text });
    else if (it.type === 'assistant') {
      const msg: any = { role: 'assistant', content: it.text || null };
      if (it.calls.length) msg.tool_calls = it.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } }));
      out.push(msg);
    } else {
      out.push({ role: 'tool', tool_call_id: it.id, content: it.content });
    }
  }
  return out;
}

interface ModelReply {
  text: string;
  calls: ToolCall[];
}

async function askModel(cfg: AiConfig, items: Item[], system: string, tools: ToolDef[], cancel?: AbortSignal): Promise<ModelReply> {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const timeout = AbortSignal.timeout(120_000);
  const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
  if (cfg.provider === 'anthropic') {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      signal,
      headers: anthropicAuthHeaders(cfg),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1500,
        system,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        messages: toAnthropic(items),
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`AI 服務回傳 ${res.status}：${json?.error?.message ?? '未知錯誤'}`);
    const text = (json.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    const calls: ToolCall[] = (json.content ?? [])
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => ({ id: c.id, name: c.name, input: c.input ?? {} }));
    return { text, calls };
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 1500,
      messages: [{ role: 'system', content: system }, ...toOpenAi(items)],
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI 服務回傳 ${res.status}：${json?.error?.message ?? '未知錯誤'}`);
  const msg = json?.choices?.[0]?.message ?? {};
  const calls: ToolCall[] = (msg.tool_calls ?? []).map((c: any) => {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(c.function?.arguments || '{}'); } catch { input = {}; }
    return { id: c.id, name: c.function?.name ?? '', input };
  });
  return { text: String(msg.content ?? '').trim(), calls };
}

// ---------------------------------------------------------------------------
// 對話迴圈
// ---------------------------------------------------------------------------
export interface AssistantDeps {
  config: () => Promise<AiConfig>;
  execute: (call: ToolCall, ctx: AssistantTurnContext) => Promise<ToolOutcome>;
}

/**
 * 執行一輪對話。history 為前端保存的紀錄（只含 user／assistant 文字），本函式會在工具呼叫期間補上中間紀錄。
 * 回傳最終文字、要切換的頁面與待確認的動作。
 */
export async function runAssistantTurn(
  deps: AssistantDeps,
  history: { role: 'user' | 'assistant'; text: string }[],
  userText: string,
  opts: { searchMode?: AssistantSearchMode; signal?: AbortSignal; page?: string; controls?: unknown } = {},
): Promise<AssistantTurn> {
  const cfg = await deps.config();
  const searchMode: AssistantSearchMode = opts.searchMode === 'traditional' ? 'traditional' : 'ai';
  const ctx: AssistantTurnContext = {
    budget: createSearchBudget<SearchHit>(searchMode === 'traditional' ? 1 : ASSISTANT_SEARCH_MAX),
    searchMode,
    userText,
    page: typeof opts.page === 'string' ? opts.page : 'home',
    controls: controlMap(sanitizeControls(opts.controls)),
  };
  const system = systemPromptFor(searchMode, ctx.page, ctx.controls);
  const items: Item[] = [
    ...history.map((h): Item => (h.role === 'user' ? { type: 'user', text: h.text } : { type: 'assistant', text: h.text, calls: [] })),
    { type: 'user', text: userText },
  ];
  const turn: AssistantTurn = { reply: '', navigate: null, pending: [], ui: [] };
  turn.reply = await runToolLoop(cfg, system, ASSISTANT_TOOLS, items, async (call) => {
    const out = await deps.execute(call, ctx);
    if (out.navigate) turn.navigate = out.navigate;
    if (out.pending) turn.pending.push(out.pending);
    if (out.ui) turn.ui.push(out.ui);
    return out;
  }, opts.signal);
  return turn;
}

/**
 * 通用的工具迴圈：反覆呼叫模型，執行它要求的工具，直到模型不再要求工具為止。
 * items 會被就地補上中間紀錄（assistant 與 tool）。最多 maxRounds 輪；超過時回傳提示文字。
 */
export async function runToolLoop(
  cfg: AiConfig,
  system: string,
  tools: ToolDef[],
  items: Item[],
  execute: (call: ToolCall) => Promise<ToolOutcome>,
  signal?: AbortSignal,
  maxRounds = 6,
): Promise<string> {
  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted) throw new JobCancelledError();
    const r = await raceAbort(askModel(cfg, items, system, tools, signal), signal);
    items.push({ type: 'assistant', text: r.text, calls: r.calls });
    if (r.calls.length === 0) return r.text || '（沒有回覆）';
    for (const call of r.calls) {
      const out = await execute(call);
      items.push({ type: 'tool', id: call.id, name: call.name, content: out.content });
    }
  }
  return '這次對話的工具呼叫次數已達上限，請把需求說得更具體一點。';
}

/** 只允許模型提議這兩種會花費 AI 額度的動作；其他名稱一律拒絕。 */
export function isProposeTool(name: string): boolean {
  return name === 'propose_scope' || name === 'propose_brief';
}

export interface SearchHit {
  id: string;
  title: string;
  date: string | null;
  cause: string;
}

/** 合併多組關鍵字的搜尋結果：依判決 id 去重，保留先出現的順序，最多回傳 limit 筆。 */
export function mergeSearchHits(groups: SearchHit[][], limit = 20): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const g of groups) {
    for (const h of g) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
