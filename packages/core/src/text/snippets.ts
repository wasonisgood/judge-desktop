// 片段擷取：找出含關鍵字的句子，附前後文視窗。移植自 crawler.py 的 _extract_snippets_from_text。
export interface Snippet {
  text: string;
  start: number;
}

/** 句子切分（中文句號、分號、驚嘆號、問號與換行）。 */
export function sentenceSplitChinese(text: string): string[] {
  return text.split(/(?<=[。；！？\n])/).map((s) => s.trim()).filter(Boolean);
}

export function extractSnippets(text: string, keyword: string, opts: { window?: number; maxSnippets?: number; afterOnly?: boolean } = {}): Snippet[] {
  const window = opts.window ?? 0;
  const max = opts.maxSnippets ?? 5;
  if (!keyword) return [];
  const sentences = sentenceSplitChinese(text);
  const out: Snippet[] = [];
  let offset = 0;
  for (let i = 0; i < sentences.length && out.length < max; i++) {
    const s = sentences[i];
    if (s.includes(keyword)) {
      const from = Math.max(0, i - (opts.afterOnly ? 0 : window));
      const to = Math.min(sentences.length, i + window + 1);
      out.push({ text: sentences.slice(from, to).join(''), start: offset });
    }
    offset += s.length;
  }
  return out;
}
