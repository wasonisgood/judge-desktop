// 爭點知識庫：把命中的爭點組裝成 AI 可讀的文字（純函式）。
// 每次只餵入相關爭點，並以字數上限控制成本；超出上限的爭點列為略過並記錄於 notes。
import type { RouteHit } from './router';
import type { KnowledgeIndex, IndexedIssue, KnowledgeFile } from './types';
import { validateKnowledgeFile, type ValidationProblem } from './validate';

export const KNOWLEDGE_CONTEXT_MAX_CHARS = 4000;

export interface KnowledgeContextOutput {
  text: string;
  /** 實際放進上下文的爭點 id。 */
  usedIds: string[];
  notes: string[];
}

function formatIssue(issue: IndexedIssue, reasons: string[]): string {
  const lines: string[] = [];
  lines.push(`【${issue.title}】（${issue.path.join(' > ')}）`);
  lines.push(`爭點：${issue.proposition}`);
  lines.push(`區分實益：${issue.distinction}`);
  for (const d of issue.doctrines) {
    lines.push(`${d.label}：${d.view}（好處：${d.pros}；利弊：${d.cons}）`);
  }
  for (const p of issue.practice) {
    const note = p.note ? `（${p.note}）` : '';
    lines.push(`實務${p.period ? `（${p.period}）` : ''}：${p.view}${note}`);
  }
  if (issue.lawRefs.length) lines.push(`相關法條：${issue.lawRefs.join('、')}`);
  if (reasons.length) lines.push(`檢索理由：${reasons.join('；')}`);
  return lines.join('\n');
}

/**
 * 組裝命中爭點的上下文。依命中順序逐筆加入，超過上限就停止並記錄略過的爭點。
 * 至少會放入第一筆（即使本身超過上限，也會截斷），避免命中卻完全沒有內容。
 */
export function buildKnowledgeContext(hits: RouteHit[], maxChars = KNOWLEDGE_CONTEXT_MAX_CHARS): KnowledgeContextOutput {
  const notes: string[] = [];
  const parts: string[] = [];
  const usedIds: string[] = [];
  let total = 0;
  for (const hit of hits) {
    const block = formatIssue(hit.issue, hit.reasons);
    const sep = parts.length ? 2 : 0;
    if (total + sep + block.length > maxChars) {
      if (parts.length === 0) {
        parts.push(block.slice(0, maxChars) + '…');
        usedIds.push(hit.issue.id);
        notes.push(`爭點「${hit.issue.title}」超過字數上限，已截斷。`);
      } else {
        notes.push(`因字數上限略過爭點「${hit.issue.title}」。`);
      }
      continue;
    }
    parts.push(block);
    usedIds.push(hit.issue.id);
    total += sep + block.length;
  }
  if (hits.length === 0) notes.push('知識庫沒有找到相關爭點。');
  return { text: parts.join('\n\n'), usedIds, notes };
}

export interface KnowledgeBuildResult {
  index: KnowledgeIndex;
  problems: ValidationProblem[];
  /** 通過驗證的檔案數。 */
  loadedFiles: number;
}

/**
 * 從多個已解析的 JSON 檔（連同來源名稱）建立索引。
 * 單一檔案或爭點驗證失敗只會記錄於 problems，不影響其他檔案。
 */
export function buildKnowledgeIndex(sources: Array<{ source: string; raw: unknown }>): KnowledgeBuildResult {
  const issues: IndexedIssue[] = [];
  const problems: ValidationProblem[] = [];
  const seen = new Set<string>();
  let loadedFiles = 0;
  for (const { source, raw } of sources) {
    const v = validateKnowledgeFile(raw, source);
    problems.push(...v.problems);
    if (!v.file) continue;
    loadedFiles++;
    for (const issue of v.issues) {
      if (seen.has(issue.id)) {
        problems.push({ source, issueId: issue.id, message: '與其他檔案的 id 重複，已略過' });
        continue;
      }
      seen.add(issue.id);
      issues.push(issue);
    }
  }
  return { index: { issues }, problems, loadedFiles };
}

export type { KnowledgeFile };
