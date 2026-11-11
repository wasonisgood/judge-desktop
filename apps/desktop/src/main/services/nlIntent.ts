// 自然語言輸入（主程序）：判斷輸入是「關鍵字」還是「自然語言」，自然語言才交給 AI 整理成各頁的欄位。
// 原則：
// 1. 關鍵字直接原樣回傳，不呼叫 AI（省額度，也不改變既有的搜尋結果）。
// 2. AI 只回傳欄位草稿；欄位會經過清理（只保留該頁認得的鍵、字串需非空），畫面回填後由使用者看得到再執行。
// 3. 沒有 AI 設定時，自然語言輸入會明確失敗，不會退回規則式猜測。
import { parseJsonReply, type AiComplete } from '@judge/core';

export type NlPage = 'list' | 'brief' | 'semantic';

/** 判斷為自然語言的依據：句末問號或語氣詞、常見的口語動詞與疑問詞。純函式，可直接測試。 */
export function looksNatural(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[?？!！]$/.test(t)) return true;
  if (/(我想|我要|想找|想查|想了解|幫我|幫忙|請幫|請找|請列|請整理|有沒有|哪些|哪一|怎麼|如何|為什麼|的判決|的案例|相關的|找出|列出|整理一下|排除|納入|不包括|必須)/.test(t)) return true;
  // 含全形逗號或句號：關鍵字通常以空白或頓號分隔，有逗號句號多半是完整句子。
  if (/[，。]/.test(t)) return true;
  // 較長、沒有空白分隔的整句（關鍵字通常是 1 到 4 個詞，以空白分隔）。
  if (t.length >= 14 && !/\s/.test(t) && /[，。、；]/.test(t)) return true;
  return false;
}

interface FieldSpec {
  key: string;
  type: 'string' | 'boolean';
  hint: string;
}

const PAGE_FIELDS: Record<NlPage, { purpose: string; fields: FieldSpec[] }> = {
  list: {
    purpose: '判決列表：依關鍵字搜尋司法院裁判書。',
    fields: [
      { key: 'keyword', type: 'string', hint: '檢索關鍵字，1 到 4 個詞，以空白分隔（案由、法名、主題詞）。' },
      { key: 'statute', type: 'string', hint: '使用者提到的相關法規名稱（例如「國家賠償法」）；沒有提到就留空字串。' },
      { key: 'smart', type: 'boolean', hint: '描述較複雜、需要 AI 協助擴充同義詞時為 true，否則 false。' },
    ],
  },
  semantic: {
    purpose: '段落檢索：先以候選關鍵字取得判決，再依語意描述在段落層級排序。',
    fields: [
      { key: 'keyword', type: 'string', hint: '候選關鍵字，1 到 4 個詞，以空白分隔，用來先取得候選判決。' },
      { key: 'query', type: 'string', hint: '使用者想找的情境或論點的完整描述（保留使用者的用語）。' },
    ],
  },
  brief: {
    purpose: '單一判決精讀：依判決名稱或關鍵字找出候選判決。',
    fields: [
      { key: 'query', type: 'string', hint: '判決名稱或關鍵字（可含法院縮寫，例如「高院 戒嚴」），去掉語氣詞與句子結構。' },
    ],
  },
};

function systemPrompt(page: NlPage): string {
  const spec = PAGE_FIELDS[page];
  const lines = spec.fields.map((f) => `- ${f.key}（${f.type === 'boolean' ? '布林值' : '字串'}）：${f.hint}`);
  return [
    '你是「司法院裁判研究」應用程式的輸入整理助理。使用者用自然語言描述想找的判決。',
    spec.purpose,
    '請只輸出一個 JSON 物件，鍵只能是下列欄位：',
    ...lines,
    '不得編造使用者沒有提到的內容；沒有提到的欄位留空字串（布林值為 false）。只輸出 JSON，不要其他說明。',
  ].join('\n');
}

export interface NlResult {
  mode: 'keyword' | 'natural';
  fields: Record<string, string | boolean>;
}

/** 清理 AI 回傳的欄位：只保留該頁定義的鍵，字串去頭尾空白，布林值只接受 true。 */
export function sanitizeNlFields(page: NlPage, raw: unknown): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const f of PAGE_FIELDS[page].fields) {
    const v = src[f.key];
    if (f.type === 'boolean') {
      if (v === true || v === 'true') out[f.key] = true;
    } else if (typeof v === 'string' && v.trim()) {
      out[f.key] = v.trim();
    }
  }
  return out;
}

/** 判斷並（必要時）整理輸入。關鍵字不呼叫 AI；自然語言呼叫 AI 一次。 */
export async function interpretInput(getAi: () => Promise<AiComplete>, page: NlPage, text: string): Promise<NlResult> {
  const input = text.trim();
  if (!looksNatural(input)) return { mode: 'keyword', fields: {} };
  // AI 只在判定為自然語言後才取得（沒有金鑰時這裡會報錯，關鍵字路徑不受影響）。
  const ai = await getAi();
  const raw = await ai(systemPrompt(page), input, 400);
  const fields = sanitizeNlFields(page, parseJsonReply<unknown>(raw));
  if (Object.keys(fields).length === 0) throw new Error('AI 沒有整理出可用的欄位，請把描述說得更具體一點，或改用關鍵字。');
  return { mode: 'natural', fields };
}

// ---------------------------------------------------------------------------
// 納入排除：一句話描述 → 核查標準列（與畫面上的標準列欄位一致）
// ---------------------------------------------------------------------------

export interface NlCriterion {
  kind: 'include' | 'exclude';
  /** AI 判斷的標準描述（method 為 ai 時使用）。 */
  text: string;
  /** ai：AI 逐案判斷；program：只看判決原文是否出現關鍵字。 */
  method: 'ai' | 'program';
  /** 關鍵字（頓號分隔；method 為 program 時使用）。 */
  keywords: string;
  keywordMode: 'any' | 'all';
}

const CRITERIA_SYSTEM = [
  '你是「納入排除核查」的標準整理助理。使用者用一句話描述納入或排除的條件。',
  '請輸出一個 JSON 物件 {"criteria":[...]}，每一項是一條標準，欄位如下：',
  '- kind："include"（納入）或 "exclude"（排除）',
  '- method："ai"（需要判斷語意，例如「原告為消費者」）或 "program"（判決原文出現特定詞即可，例如「含『戒嚴』」）',
  '- text：method 為 ai 時的標準描述，一句話',
  '- keywords：method 為 program 時的關鍵字陣列',
  '- keywordMode："any"（任一出現）或 "all"（全部出現）',
  '只整理使用者明確說過的條件，不得編造；最多 8 條。只輸出 JSON，不要其他說明。',
].join('\n');

/** 清理 AI 回傳的標準列：只保留合法欄位；ai 需要描述、program 需要關鍵字，否則捨棄。 */
export function sanitizeCriteria(raw: unknown): NlCriterion[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const list = (raw as Record<string, unknown>).criteria;
  if (!Array.isArray(list)) return [];
  const out: NlCriterion[] = [];
  for (const item of list.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const kind = c.kind === 'exclude' ? 'exclude' : 'include';
    const method = c.method === 'program' ? 'program' : 'ai';
    const text = typeof c.text === 'string' ? c.text.trim() : '';
    const kwRaw = Array.isArray(c.keywords) ? c.keywords.map(String) : typeof c.keywords === 'string' ? c.keywords.split(/[,，、\s]+/) : [];
    const keywords = kwRaw.map((k) => k.trim()).filter(Boolean).join('、');
    const keywordMode = c.keywordMode === 'all' ? 'all' : 'any';
    if (method === 'ai' && !text) continue;
    if (method === 'program' && !keywords) continue;
    out.push({ kind, text, method, keywords, keywordMode });
  }
  return out;
}

export interface NlCriteriaResult {
  mode: 'keyword' | 'natural';
  criteria: NlCriterion[];
}

/** 一句話描述 → 標準列。關鍵字式輸入直接成為一條程式判斷的納入標準（不呼叫 AI）。 */
export async function interpretCriteria(getAi: () => Promise<AiComplete>, text: string): Promise<NlCriteriaResult> {
  const input = text.trim();
  if (!input) throw new Error('請先輸入納入或排除的描述');
  if (!looksNatural(input)) {
    const keywords = input.split(/[,，、\s]+/).filter(Boolean).join('、');
    return { mode: 'keyword', criteria: [{ kind: 'include', text: '', method: 'program', keywords, keywordMode: 'any' }] };
  }
  const ai = await getAi();
  const raw = await ai(CRITERIA_SYSTEM, input, 800);
  const criteria = sanitizeCriteria(parseJsonReply<unknown>(raw));
  if (criteria.length === 0) throw new Error('AI 沒有整理出可用的標準，請把條件說得更具體一點，或直接輸入關鍵字。');
  return { mode: 'natural', criteria };
}
