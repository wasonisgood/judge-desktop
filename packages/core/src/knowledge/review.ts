// 爭點知識庫：AI 檢閱 Router 結果（純函式，不呼叫模型）。
// 讓 AI 判斷這次挑出的爭點是否與查詢相關；不相關時 AI 可以提出更精準的查詢詞，由呼叫端重新檢索。
import type { RouteHit } from './router';

export interface ReviewPrompt {
  system: string;
  user: string;
}

export type ReviewReply =
  | { ok: true }
  | { ok: false; query?: string };

/** 組出給 AI 的檢閱提示：只列出爭點標題與路徑（不含全文），控制成本。 */
export function buildReviewPrompt(query: string, hits: RouteHit[]): ReviewPrompt {
  const list = hits.length
    ? hits.map((h, i) => `${i + 1}. [${h.issue.id}] ${h.issue.title}（${h.issue.path.join(' > ')}）`).join('\n')
    : '（沒有挑出任何爭點）';
  return {
    system: [
      '你是法律知識庫的檢索檢查員。判斷下列爭點是否與使用者的查詢相關。',
      '若大多數爭點與查詢相關，回覆 {"ok":true}。',
      '若大多數不相關或沒有爭點，回覆 {"ok":false,"query":"更精準的查詢詞（繁體中文，一行）"}。',
      '只回覆 JSON，不要其他文字。',
    ].join('\n'),
    user: `查詢：${query}\n\n挑出的爭點：\n${list}`,
  };
}

/** 解析 AI 的回覆；格式不合法回傳 null（呼叫端應視為「不重新檢索」，避免浪費）。 */
export function parseReviewReply(text: string): ReviewReply | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o.ok === true) return { ok: true };
  if (o.ok === false) {
    const q = typeof o.query === 'string' ? o.query.trim() : '';
    return q ? { ok: false, query: q } : { ok: false };
  }
  return null;
}
