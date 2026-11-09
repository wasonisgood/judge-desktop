// 法規輸入的解析（純函數，不做 I/O）：使用者輸入的一行可能是「法名」，或「法名＋條項款」。
import { parseSingleCitation, parseCitations, type CitationRef, type ScopeRow } from '@judge/core';

/** 使用者輸入的一行：法名，或「法名＋條項款」（例如「民法第184條第1項第2款」）。 */
export function splitStatuteLine(line: string): { name: string; citation: CitationRef | null } {
  const t = line.trim();
  const cut = t.search(/第\s*[0-9０-９一二三四五六七八九十百千零〇兩]/);
  const name = (cut >= 0 ? t.slice(0, cut) : t).trim();
  return { name, citation: cut >= 0 ? parseSingleCitation(t.slice(cut)) : null };
}

/** 判決是否引用了指定的條（若有指定項、款，也要一併符合）。 */
export function rowCites(row: ScopeRow, cit: CitationRef): boolean {
  return parseCitations(row.citedArticles.join('；')).some((c) =>
    c.article === cit.article &&
    (cit.paragraph === undefined || c.paragraph === cit.paragraph) &&
    (cit.item === undefined || c.item === cit.item));
}
