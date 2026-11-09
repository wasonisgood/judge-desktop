// AI 分析：範圍整理表（逐案分析＋法規綜合分析）與單一判決精讀。
// 所有內容都由 AI 產生，只根據提供的判決原文，不得編造。AI 回覆必須是 JSON，解析失敗會重試一次。
import type { JudgmentDetail } from '../court/parse';
import type { ScopeRow } from '../court/scope';
import { DEFAULT_CODING_FIELDS, normalizeCodingFields, verifyCodedValues, type CodedValue, type CodingFieldInput } from '../pipeline/coding';

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
  /** 以下五欄為預設欄位的舊格式對應（由 values 填入），保留給舊結果與既有匯出使用。 */
  issue: string;        // 本案爭點
  holding: string;      // 法院見解（核心論證）
  statuteApplication: string; // 該法規如何被適用或排除
  outcome: string;      // 結論（駁回、廢棄發回、准許等）
  group: string;        // AI 歸類的類型名稱（例如：財產損害、政治案件、程序駁回）
  /** 依分析欄位的編碼結果（含逐字依據與待覆核標示），順序同欄位設定。 */
  values?: CodedValue[];
}

export interface AnalyzeCaseOptions {
  /** 法規現行條文（已由呼叫端取得、只含本案引用的條文）；提供後 AI 會依現行條文判讀。 */
  currentText?: string;
  /** 分析欄位（預設集或使用者自訂）；未提供時使用預設欄位。 */
  fields?: CodingFieldInput[];
}

const LEGACY_KEYS = ['issue', 'holding', 'statuteApplication', 'outcome', 'group'] as const;

/**
 * 逐案分析（標編碼工序）：一次 AI 呼叫產生所有勾選欄位，每個欄位附逐字依據。
 * 依據必須逐字出現在判決原文中，驗證不過的依據丟掉；內容或依據不全的欄位標示為待覆核。
 */
export async function analyzeCase(ai: AiComplete, statute: string, row: ScopeRow, d: JudgmentDetail, opts: AnalyzeCaseOptions = {}): Promise<CaseAnalysis> {
  const fields = normalizeCodingFields(opts.fields ?? DEFAULT_CODING_FIELDS);
  if (fields.length === 0) throw new Error('請至少勾選一個分析欄位');
  const system = '你是台灣法律研究助理。只根據提供的判決原文作答，不得編造。以繁體中文回答，並且只輸出一個 JSON 物件。';
  const user = [
    `研究的法規：${statute}`,
    `判決字號：${d.meta.title}`,
    `歷審位置：${d.historyPosition?.summary ?? '未取得歷審資料'}`,
    `引用條文：${row.citedArticles.join('；') || '（僅提及法規名稱）'}`,
    ...((row.lawNotes ?? []).length ? ["法條異動提示（由法條沿革比對，請在分析中一併考慮）：", ...(row.lawNotes ?? []).map((n) => `- ${n.summary}`)] : []),
    ...(opts.currentText ? ['法規現行條文（引用條文的現行內容，判讀時請對照）：', opts.currentText.slice(0, 2000)] : []),
    '',
    '請對下列每個欄位輸出內容與依據，格式如下（values 必須包含每一個 id，一個都不能少）：',
    '{"values":[{"id":"欄位 id","value":"內容（限 120 字以內的繁體中文，不要換行）","evidence":["依據的原文逐字引用"]}]}',
    '依據規則：每個欄位的 evidence 為 1 到 2 句從判決原文逐字複製的句子（每句 8 到 80 字），必須真的出現在下方的判決原文中；找不到依據就留空陣列，不可自行改寫。',
    '欄位如下：',
    ...fields.map((f) => `- id「${f.id}」｜${f.name}${f.description ? `：${f.description}` : ''}`),
    '判決中找不到的資訊，內容寫明「判決原文未載明」。',
    '',
    '判決原文：',
    bodyOf(d),
  ].join('\n');
  const reply = await askJson<unknown>(ai, system, user, Math.min(4000, 800 + fields.length * 350));
  // 相容舊格式（欄位直接放在物件頂層）：沒有依據，因此會標示為待覆核。
  const hasValues = reply && typeof reply === 'object' && Array.isArray((reply as { values?: unknown }).values);
  const normalized = hasValues ? reply : { values: fields.map((f) => ({ id: f.id, value: (reply as Record<string, unknown> | null)?.[f.id] })) };
  const values = verifyCodedValues(d.fullText, fields, normalized);
  const byField = new Map(values.map((v) => [v.fieldId, v.value]));
  const legacy = Object.fromEntries(LEGACY_KEYS.map((k) => [k, byField.get(k) ?? '']));
  return { id: row.id, ...legacy, group: legacy.group || '未分類', values } as CaseAnalysis;
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
  /** 依據的判決原文（已驗證存在於原文中）。 */
  evidence?: string[];
}

export interface BriefDocument {
  title: string;
  sections: BriefSection[];
  /** 未能在判決原文中找到而被移除的引文數量（不猜、不保留）。 */
  droppedQuotes?: number;
}

/** 精讀的欄位：名稱必填；說明選填，AI 會依說明整理該欄位。 */
export interface BriefField {
  name: string;
  description?: string;
}

import { keepVerifiedQuotes } from './evidence';

/** 預設欄位（與原本的六段一致）。使用者可取消勾選，也可加入自訂欄位。 */
export const DEFAULT_BRIEF_FIELDS: BriefField[] = [
  { name: '一、案件事實' },
  { name: '二、爭點' },
  { name: '三、當事人主張' },
  { name: '四、法院見解' },
  { name: '五、結論' },
  { name: '六、與使用者重點相關的整理' },
];

/** 清理欄位：去除空白名稱與重複名稱，保留順序。 */
export function normalizeBriefFields(fields: BriefField[]): BriefField[] {
  const seen = new Set<string>();
  const out: BriefField[] = [];
  for (const f of fields) {
    const name = (f.name ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description: (f.description ?? '').trim() || undefined });
  }
  return out;
}

export async function briefJudgment(
  ai: AiComplete,
  d: JudgmentDetail,
  opts: { focus: string; length: string; fields?: BriefField[]; lawContext?: string },
): Promise<BriefDocument> {
  const system = '你是台灣法律研究助理。依使用者指定的重點、長度與欄位，只根據提供的判決原文整理，不得編造。以繁體中文回答，並且只輸出一個 JSON 物件。';
  const focus = opts.focus.trim() || '由你判斷最重要的爭點、事實、理由與主文';
  const fields = normalizeBriefFields(opts.fields && opts.fields.length ? opts.fields : DEFAULT_BRIEF_FIELDS);
  if (fields.length === 0) throw new Error('請至少勾選一個要整理的欄位');
  const fieldLines = fields.map((f, i) => `${i + 1}. ${f.name}${f.description ? `：${f.description}` : ''}`);
  const user = [
    `判決字號：${d.meta.title}`,
    `歷審位置：${d.historyPosition?.summary ?? '未取得歷審資料'}`,
    `法院：${d.meta.court ?? ''}　日期：${d.meta.dateIso ?? d.meta.dateMinguo}　案由：${d.meta.cause}`,
    `使用者想了解的重點：${focus}`,
    ...(opts.lawContext ? ['判決引用法規的現行條文與沿革（判讀時請對照，不可編造條文內容）：', opts.lawContext, ''] : []),
    `輸出長度：${opts.length}`,
    '',
    '請輸出 JSON，格式：{"title":"文書標題","sections":[{"heading":"段落標題","paragraphs":["段落一"],"evidence":["依據的原文逐字引用"]}]}',
    '每個段落的 evidence 必須是從判決原文逐字複製的句子（每段 1 到 3 句，每句 15 到 80 字），必須真的出現在下方的判決原文中；找不到依據就留空陣列，不可自行改寫。',
    '段落標題必須依序為下列欄位，一個都不能少、也不要多加其他段落：',
    ...fieldLines,
    '每個段落都要有實質內容，不能只寫「無」。若判決中找不到某項資訊，該段寫明「判決原文未載明」。每段限 200 字以內，段落數依篇幅調整，務必輸出完整的 JSON。',
    '',
    '判決原文：',
    bodyOf(d),
  ].join('\n');
  const r = await askJson<BriefDocument>(ai, system, user, 4500);
  if (!Array.isArray(r.sections) || r.sections.length === 0) throw new Error('AI 沒有產生任何段落');
  // 只保留真的在原文中出現的引文
  let dropped = 0;
  const sections = r.sections.map((sec) => {
    const raw = Array.isArray((sec as { evidence?: unknown }).evidence) ? ((sec as { evidence?: unknown[] }).evidence ?? []).length : 0;
    const evidence = keepVerifiedQuotes(d.fullText, (sec as { evidence?: unknown }).evidence);
    dropped += Math.max(0, raw - evidence.length);
    return { ...sec, evidence };
  });
  return { title: r.title || d.meta.title, sections, droppedQuotes: dropped };
}

// ---------------------------------------------------------------------------
// 判決列表：依主題由 AI 篩選相關判決（只根據字號、案由、日期判斷，成本低）
// ---------------------------------------------------------------------------
export interface RelevanceItem {
  id: string;
  title: string;
  cause: string;
  dateIso: string | null;
}

export interface RelevanceVerdict {
  relevant: boolean;
  reason: string;
}

/** 回傳每個 id 的判斷；AI 漏掉的 id 一律視為不相關（不猜）。 */
export async function screenRelevance(
  ai: AiComplete,
  topic: string,
  items: RelevanceItem[],
): Promise<Record<string, RelevanceVerdict>> {
  const system = '你是台灣法律研究助理。依使用者的研究主題，判斷每一筆判決是否與主題相關。只根據提供的字號與案由判斷，不得編造。以繁體中文回答，並且只輸出一個 JSON 物件。';
  const user = [
    `研究主題：${topic}`,
    '',
    '請對每一筆判決判斷是否與研究主題相關，輸出 JSON：',
    '{"results":[{"id":"判決 id","relevant":true或false,"reason":"一句話理由（20 字以內）"}]}',
    '必須包含下列每一個 id，一個都不能少。',
    '',
    '判決清單（id｜字號｜案由｜日期）：',
    ...items.map((it) => `${it.id}｜${it.title}｜${it.cause || '（無案由）'}｜${it.dateIso ?? '—'}`),
  ].join('\n');
  const r = await askJson<{ results: { id: string; relevant: boolean; reason: string }[] }>(ai, system, user, 2000);
  const out: Record<string, RelevanceVerdict> = {};
  for (const it of items) out[it.id] = { relevant: false, reason: '未判定' };
  for (const x of Array.isArray(r.results) ? r.results : []) {
    if (x && typeof x.id === 'string' && out[x.id] !== undefined) {
      out[x.id] = { relevant: x.relevant === true, reason: String(x.reason ?? '').slice(0, 60) || (x.relevant ? '相關' : '不相關') };
    }
  }
  return out;
}
