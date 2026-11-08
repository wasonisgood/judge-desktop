// 精讀的「依據原文」：AI 整理的每一段，附上它依據的判決原文（逐字引用）。
// 程式會驗證：引文必須真的出現在判決原文中（忽略空白與全形差異），找不到的引文一律丟掉，不採信。
// 同時提供把原文切開、標出引文位置的工具，供畫面與 Word 螢光標示使用。

/** 去除空白與全形/半形差異，用於比對。 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/[　]/g, '')
    .replace(/，/g, ',')
    .replace(/：/g, ':');
}

/** 若引文出現在原文中，回傳它在原文中的起訖位置（以原文字元計）；找不到回傳 null。 */
export function locateQuote(fullText: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim();
  if (q.length < 6) return null; // 太短的引文容易誤中，不採信
  const direct = fullText.indexOf(q);
  if (direct >= 0) return { start: direct, end: direct + q.length };
  // 允許原文中的換行或空白與引文不同：逐字建立去空白對應表
  const chars: { ch: string; idx: number }[] = [];
  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i];
    if (/\s/.test(ch) || ch === '　') continue;
    chars.push({ ch: ch === '，' ? ',' : ch === '：' ? ':' : ch, idx: i });
  }
  const compact = normalizeForMatch(q);
  const flat = chars.map((c) => c.ch).join('');
  const at = flat.indexOf(compact);
  if (at < 0) return null;
  const start = chars[at].idx;
  const end = chars[at + compact.length - 1].idx + 1;
  return { start, end };
}

export interface EvidenceSpan {
  start: number;
  end: number;
}

/** 把原文切成段落，標出所有引文的位置（重疊的區段會合併）。 */
export function highlightSpans(fullText: string, quotes: string[]): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  for (const q of quotes) {
    const loc = locateQuote(fullText, q);
    if (loc) spans.push(loc);
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: EvidenceSpan[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/** 把驗證過的引文從 AI 回覆中篩出來；不在原文中的引文一律丟掉。 */
export function keepVerifiedQuotes(fullText: string, quotes: unknown): string[] {
  if (!Array.isArray(quotes)) return [];
  const out: string[] = [];
  for (const q of quotes) {
    if (typeof q !== 'string') continue;
    if (locateQuote(fullText, q)) out.push(q.trim());
  }
  return [...new Set(out)];
}
