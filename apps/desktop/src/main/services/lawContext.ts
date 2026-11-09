// 法規上下文的資料取得（issue #4 第 4 點）：取得現行條文與沿革，交給核心組裝成 AI 可讀的文字。
// 任何一步失敗都只記錄在 notes 中，不中斷流程。
import { buildLawContext, parseCitations, type LawContextOutput } from '@judge/core';
import { resolveStatuteOrCandidates, currentLawFor, lawHistoryFor } from '../data/cloud/lawRepo';

/** 依法名（與可選的引用條文）取得法規上下文。法名無法確認時回傳空文字與說明。 */
export async function lawContextForStatute(name: string, cited: string[] = []): Promise<LawContextOutput & { statuteName: string | null }> {
  let resolved;
  try {
    resolved = await resolveStatuteOrCandidates(name);
  } catch (err) {
    return { text: '', notes: [`法規「${name}」確認失敗：${err instanceof Error ? err.message : String(err)}`], statuteName: null };
  }
  if (resolved.status === 'candidates') {
    return { text: '', notes: [`法規「${name}」有多個候選（${resolved.candidates.join('、')}），未套用法規上下文。`], statuteName: null };
  }
  const notes: string[] = resolved.note ? [resolved.note] : [];
  let law = null;
  try { law = await currentLawFor(resolved.pcode); } catch (err) { notes.push(`現行條文取得失敗：${err instanceof Error ? err.message : String(err)}`); }
  let history: Awaited<ReturnType<typeof lawHistoryFor>> = [];
  try { history = await lawHistoryFor(resolved.name); } catch (err) { notes.push(`法條沿革取得失敗：${err instanceof Error ? err.message : String(err)}`); }
  const ctx = buildLawContext({ statuteName: resolved.name, law, history, cited });
  return { text: ctx.text, notes: [...notes, ...ctx.notes], statuteName: resolved.name };
}

/** 依判決「相關法條」欄（例如「民法第184條第1項」）分組，逐部法規取得上下文。 */
export async function lawContextForCitations(relatedLaws: string[]): Promise<{ text: string; notes: string[] }> {
  const groups = new Map<string, string[]>();
  for (const line of relatedLaws) {
    const name = line.split('第')[0].trim();
    if (!name) continue;
    groups.set(name, [...(groups.get(name) ?? []), line]);
  }
  const texts: string[] = [];
  const notes: string[] = [];
  for (const [name, lines] of groups) {
    const refs = parseCitations(lines.join('；'));
    if (refs.length === 0) { notes.push(`「${name}」沒有可辨識的條號，未取得該法規內容。`); continue; }
    const r = await lawContextForStatute(name, lines);
    if (r.text) texts.push(r.text);
    notes.push(...r.notes);
  }
  return { text: texts.join('\n\n'), notes };
}
