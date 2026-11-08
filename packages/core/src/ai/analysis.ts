// AI 分析：範圍整理表（逐案分析＋法規綜合分析）與單一判決精讀。
// 所有內容都由 AI 產生，只根據提供的判決原文，不得編造。AI 回覆必須是 JSON，解析失敗會重試一次。
import type { JudgmentDetail } from '../court/parse';
import type { ScopeRow } from '../court/scope';

/** 呼叫 AI 的函式由呼叫端提供（桌面端、遠端 MCP 各自帶入自己的金鑰與服務）。 */
export type AiComplete = (system: string, user: string, maxTokens: number) => Promise<string>;

const MAX_BODY = 14000;

function bodyOf(d: JudgmentDetail): string {
  const parts = Object.entries(d.sections).map(([k, v]) => `【${k}】\n${v}`);
  const text = parts.length ? parts.join('\n\n') : d.fullText;
  return text.slice(0, MAX_BODY);
}

/** 從 AI 回覆取出 JSON；允許前後有說明文字或 ``` 圍欄。 */
export function parseJsonReply<T>(raw: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('AI 回覆不是 JSON');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

async function askJson<T>(ai: AiComplete, system: string, user: string, maxTokens: number): Promise<T> {
  // 只有「回覆不是合法 JSON」才重試；服務端錯誤（金鑰、額度、網路）直接原樣丟出。
  const raw1 = await ai(system, user, maxTokens);
  try {
    return parseJsonReply<T>(raw1);
  } catch {
    const raw2 = await ai(system, user, maxTokens);
    try {
      return parseJsonReply<T>(raw2);
    } catch (err) {
      throw new Error(`AI 回覆不是有效的 JSON：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 範圍整理表：逐案分析
// ---------------------------------------------------------------------------
export interface CaseAnalysis {
  id: string;
  issue: string;        // 本案爭點
  holding: string;      // 法院見解（核心論證）
  statuteApplication: string; // 該法規如何被適用或排除
  outcome: string;      // 結論（駁回、廢棄發回、准許等）
  group: string;        // AI 歸類的類型名稱（例如：財產損害、政治案件、程序駁回）
}

export async function analyzeCase(ai: AiComplete, statute: string, row: ScopeRow, d: JudgmentDetail): Promise<CaseAnalysis> {
  const system = '你是台灣法律研究助理。只根據提供的判決原文作答，不得編造。以繁體中文回答，並且只輸出一個 JSON 物件。';
  const user = [
    `研究的法規：${statute}`,
    `判決字號：${d.meta.title}`,
    `歷審位置：${d.historyPosition?.summary ?? '未取得歷審資料'}`,
    `引用條文：${row.citedArticles.join('；') || '（僅提及法規名稱）'}`,
    ...((row.lawNotes ?? []).length ? ["法條異動提示（由法條沿革比對，請在分析中一併考慮）：", ...(row.lawNotes ?? []).map((n) => `- ${n.summary}`)] : []),
    '',
    '請輸出 JSON，欄位如下。每個欄位限 120 字以內的繁體中文，不要換行，不要加說明文字：',
    '{"issue":"本案爭點","holding":"法院見解（核心論證）","statuteApplication":"該法規如何被適用或排除","outcome":"結論（駁回、廢棄發回、准許等）","group":"依案件性質歸類的類型名稱（四字到十字）"}',
    '',
    '判決原文：',
    bodyOf(d),
  ].join('\n');
  const r = await askJson<Omit<CaseAnalysis, 'id'>>(ai, system, user, 2000);
  return { id: row.id, issue: r.issue ?? '', holding: r.holding ?? '', statuteApplication: r.statuteApplication ?? '', outcome: r.outcome ?? '', group: r.group ?? '未分類' };
}

// ---------------------------------------------------------------------------
// 範圍整理表：法規綜合分析（跨案）
// ---------------------------------------------------------------------------
export interface ScopeSynthesis {
  overview: string;               // 整體概述
  groups: { name: string; description: string; caseIds: string[] }[];
  trends: string;                 // 法院見解的趨勢與分歧
  conclusion: string;             // 研究結論
}

export async function synthesizeScope(ai: AiComplete, statute: string, analyses: CaseAnalysis[]): Promise<ScopeSynthesis> {
  const system = '你是台灣法律研究助理。根據提供的逐案分析做綜合整理，只根據提供的資料，不得編造。以繁體中文回答，並且只輸出一個 JSON 物件。';
  const user = [
    `研究的法規：${statute}`,
    `案件數：${analyses.length}`,
    '',
    '逐案分析（JSON）：',
    JSON.stringify(analyses).slice(0, 30000),
    '',
    '請輸出 JSON：',
    '{"overview":"整體概述（一段）","groups":[{"name":"類型名稱","description":"此類案件的共同特徵","caseIds":["案件 id"]}],"trends":"法院見解的趨勢與分歧（一段）","conclusion":"研究結論（一段）"}',
  ].join('\n');
  const r = await askJson<ScopeSynthesis>(ai, system, user, 2500);
  return { overview: r.overview ?? '', groups: Array.isArray(r.groups) ? r.groups : [], trends: r.trends ?? '', conclusion: r.conclusion ?? '' };
}

// ---------------------------------------------------------------------------
// 單一判決精讀：完整結構化摘要（對應 R3 民法作業式文書）
// ---------------------------------------------------------------------------
export interface BriefSection {
  heading: string;
  paragraphs: string[];
}

export interface BriefDocument {
  title: string;
  sections: BriefSection[];
}

export async function briefJudgment(
  ai: AiComplete,
  d: JudgmentDetail,
  opts: { focus: string; length: string },
): Promise<BriefDocument> {
  const system = '你是台灣法律研究助理。依使用者指定的重點與長度，只根據提供的判決原文整理，不得編造。以繁體中文回答，並且只輸出一個 JSON 物件。';
  const focus = opts.focus.trim() || '由你判斷最重要的爭點、事實、理由與主文';
  const user = [
    `判決字號：${d.meta.title}`,
    `歷審位置：${d.historyPosition?.summary ?? '未取得歷審資料'}`,
    `法院：${d.meta.court ?? ''}　日期：${d.meta.dateIso ?? d.meta.dateMinguo}　案由：${d.meta.cause}`,
    `使用者想了解的重點：${focus}`,
    `輸出長度：${opts.length}`,
    '',
    '請輸出 JSON，格式：{"title":"文書標題","sections":[{"heading":"段落標題","paragraphs":["段落一","段落二"]}]}',
    '段落標題依序包含：一、案件事實；二、爭點；三、當事人主張；四、法院見解；五、結論；六、與使用者重點相關的整理。',
    '每個段落都要有實質內容，不能只寫「無」。若判決中找不到某項資訊，該段寫明「判決原文未載明」。每段限 200 字以內，段落數依篇幅調整，務必輸出完整的 JSON。',
    '',
    '判決原文：',
    bodyOf(d),
  ].join('\n');
  const r = await askJson<BriefDocument>(ai, system, user, 4500);
  if (!Array.isArray(r.sections) || r.sections.length === 0) throw new Error('AI 沒有產生任何段落');
  return { title: r.title || d.meta.title, sections: r.sections };
}
