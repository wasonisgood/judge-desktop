// AI 提議下一組判決搜尋關鍵字（issue #4 第 1、3 點）。
// AI 只看到使用者需求與已嘗試過的關鍵字，不看判決全文。語意不清時回傳 unclear，交由呼叫端詢問使用者。
import { parseJsonReply, type AiComplete } from '../ai/analysis';
import { buildClarifyOptions, type ClarifyOption, type QueryProposal } from './queryRounds';

export interface ProposeInput {
  /** 使用者原本的需求（自然語言或關鍵字）。 */
  request: string;
  tried: string[];
  keptCount: number;
  round: number;
}

export async function proposeQueries(ai: AiComplete, input: ProposeInput): Promise<QueryProposal> {
  const system = '你是台灣法律研究助理，負責把使用者的研究需求改寫成司法院判決查詢的關鍵字。只輸出一個 JSON 物件，不要編造判決。';
  const user = [
    `使用者需求：${input.request}`,
    `已嘗試的關鍵字：${input.tried.join('、') || '（無）'}`,
    `目前保留的結果：${input.keptCount} 筆（第 ${input.round} 輪後）`,
    '',
    '若能判斷，請提議 1 到 3 組新的關鍵字（與已嘗試的不同，短詞為佳）。',
    '若需求語意不清（例如同時可能指兩種法律領域），請回報 unclear 並提出 2 到 3 個候選解讀。',
    '輸出 JSON：{"unclear":false,"queries":["關鍵字"],"reason":"一句話理由"}',
    '或 {"unclear":true,"question":"要問使用者的問題","candidates":[{"label":"解讀名稱","description":"說明"}]}',
  ].join('\n');
  const raw = await ai(system, user, 800);
  const r = parseJsonReply<{ unclear?: boolean; queries?: unknown; reason?: unknown; question?: unknown; candidates?: { label?: unknown; description?: unknown }[] }>(raw);
  if (r.unclear === true) {
    const candidates = (Array.isArray(r.candidates) ? r.candidates : [])
      .map((c) => ({ label: String(c.label ?? '').trim(), description: String(c.description ?? '').trim() }))
      .filter((c) => c.label);
    const options: ClarifyOption[] = buildClarifyOptions(candidates);
    return { unclear: true, question: String(r.question ?? '請確認您想查詢的範圍。'), options };
  }
  const queries = (Array.isArray(r.queries) ? r.queries : []).map((q) => String(q)).filter(Boolean).slice(0, 3);
  return { unclear: false, queries, reason: String(r.reason ?? '').slice(0, 100) };
}
