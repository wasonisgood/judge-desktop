// 結果內小助手（issue #10）：只回答目前結果集的問題，每個結論必須附案號。
// 規則：送給 AI 的內容只包含結果集內的判決段落；回答中出現的案號若不在結果集內，視為越界引用，整則回答標示為不可採信。
// 純函式：AI 呼叫由呼叫端注入。
import type { AiComplete } from './analysis';

export interface ScopedCase {
  caseNo: string;
  passages: string[];
}

const CASE_NO = /\d{2,3}\s*年度\s*[一-龥A-Za-z]+?\s*字第\s*\d+\s*號/g;

/** 案號的比對鍵：去掉空白，統一「第 1 號」與「第1號」。 */
export function caseNoKey(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 組出小助手的提示。段落總量以 maxChars 截斷，避免超過模型上下文；被截掉的案件會列在提示中說明。 */
export function buildScopedQaPrompt(question: string, cases: ScopedCase[], maxChars = 12000): { system: string; user: string; omitted: number } {
  const lines: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const c of cases) {
    const block = `【${c.caseNo}】\n${c.passages.join('\n')}`;
    if (used + block.length > maxChars) {
      omitted++;
      continue;
    }
    used += block.length;
    lines.push(block);
  }
  return {
    system: [
      '你是判決研究助手。只根據下列「結果集」中的判決段落回答問題，不得引用結果集以外的判決，也不得編造。',
      '每個結論後面都要附上案號，例如（110年度消字第1號）。若結果集沒有足夠依據，請直接說明「結果集中沒有足夠依據」。',
      '以繁體中文（台灣用語）回答。',
    ].join('\n'),
    user: `問題：${question}\n\n結果集：\n${lines.join('\n\n')}${omitted ? `\n\n（另有 ${omitted} 件因篇幅限制未列入，請勿推測其內容。）` : ''}`,
    omitted,
  };
}

export type ScopedAnswerStatus = 'ok' | 'outside_citation' | 'uncited';

export interface ScopedAnswerCheck {
  status: ScopedAnswerStatus;
  /** 回答中引用的案號（去重）。 */
  cited: string[];
  /** 引用到結果集以外的案號。 */
  outside: string[];
  message: string;
}

/** 檢查小助手的回答：只有引用的案號全部在結果集內、且至少引用一個案號，才標示為 ok。 */
export function checkScopedAnswer(answer: string, allowedCaseNos: string[]): ScopedAnswerCheck {
  const allowed = new Set(allowedCaseNos.map(caseNoKey));
  const found = [...new Set((answer.match(CASE_NO) ?? []).map(caseNoKey))];
  const outside = found.filter((c) => !allowed.has(c));
  if (outside.length) {
    return { status: 'outside_citation', cited: found, outside, message: `回答引用了結果集以外的案號：${outside.join('、')}，此回答不可採信。` };
  }
  if (!found.length) {
    return { status: 'uncited', cited: [], outside: [], message: '回答沒有附上案號，無法對照結果集，請重新提問。' };
  }
  return { status: 'ok', cited: found, outside: [], message: '' };
}

/** 執行一次小助手問答：回答與檢查結果一併回傳；AI 服務錯誤原樣拋出。 */
export async function askScopedQuestion(ai: AiComplete, question: string, cases: ScopedCase[]): Promise<{ answer: string; check: ScopedAnswerCheck; omitted: number }> {
  if (!cases.length) throw new Error('結果集是空的，無法回答');
  const prompt = buildScopedQaPrompt(question, cases);
  const answer = await ai(prompt.system, prompt.user, 1200);
  return {
    answer,
    check: checkScopedAnswer(answer, cases.map((c) => c.caseNo)),
    omitted: prompt.omitted,
  };
}
