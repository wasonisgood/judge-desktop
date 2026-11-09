// 法規上下文（issue #4 第 4 點）：每一階段把法規的現行條文與沿革交給 AI 讀入。
// 這裡只做組裝（純函式）；取得資料由桌面端的資料層負責。輸出有字數上限，避免超過模型上下文。
import type { CurrentLaw } from '../law/articles';
import { currentTextForCitations } from '../law/articles';
import type { HistoryArticle } from '../law/history';
import { citationLawNotes } from '../law/citationNotes';
import { parseCitations } from '../law/citation';

export const LAW_CONTEXT_MAX_CHARS = 3000;

export interface LawContextInput {
  statuteName: string;
  /** 現行法規（取得失敗時為 null）。 */
  law: CurrentLaw | null;
  /** 法條沿革（取得失敗時為空陣列）。 */
  history: HistoryArticle[];
  /** 判決引用的條文（例如「民法第184條第1項」）；提供時只取引用條文的現行內容。沒有提供時取前幾條節錄。 */
  cited?: string[];
}

export interface LawContextOutput {
  text: string;
  notes: string[];
}

function limit(s: string): string {
  return s.length > LAW_CONTEXT_MAX_CHARS ? s.slice(0, LAW_CONTEXT_MAX_CHARS) + '…' : s;
}

export function buildLawContext(input: LawContextInput): LawContextOutput {
  const notes: string[] = [];
  const lines: string[] = [`法規：${input.statuteName}`];
  if (input.law) {
    const cited = input.cited ?? [];
    const cur = cited.length ? currentTextForCitations(input.law, cited) : undefined;
    if (cited.length && cur) {
      lines.push('引用條文的現行內容：', cur);
    } else if (!cited.length) {
      const head = input.law.articles.slice(0, 12).map((a) => `${a.noText}`).join('、');
      lines.push(`現行條文共 ${input.law.articles.length} 條（前段條號：${head}）。`);
    } else {
      notes.push(`引用條文在現行法規中找不到對應內容：${cited.join('、')}`);
    }
  } else {
    notes.push(`「${input.statuteName}」現行條文未取得，AI 只依提供的資料判讀。`);
  }
  if (input.history.length) {
    const cited = input.cited ?? [];
    const refs = cited.length ? parseCitations(cited.join('；')) : [];
    const targetArticles = refs.length ? refs : undefined;
    const notesFromHistory = targetArticles
      ? citationLawNotes(targetArticles, input.history, {})
      : [];
    for (const n of notesFromHistory) lines.push(`- ${n.summary}`);
    if (!targetArticles) {
      const changed = input.history.filter((h) => h.versions.length > 1).slice(0, 8);
      if (changed.length) lines.push(`有修正沿革的條文：${changed.map((h) => h.noText).join('、')}。`);
    }
  } else {
    notes.push(`「${input.statuteName}」法條沿革未取得。`);
  }
  return { text: limit(lines.join('\n')), notes };
}
