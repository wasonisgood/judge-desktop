// 判決引用的條文，對照法條沿革，說明在查詢期間內是否修法、條文是否改變。
// 結果會附在範圍整理表的每一列，並交給 AI 分析，讓 AI 知道同一條在不同時間的文字不同。
import type { CitationRef } from './citation';
import type { HistoryArticle } from './history';
import { periodReport } from './period';

export type CitationLawStatus = 'unchanged' | 'changed' | 'not_in_history' | 'no_period';

export interface CitationLawNote {
  /** 引用原文，例如「第184條第1項」。 */
  citation: string;
  article: string;
  paragraph?: number;
  item?: number;
  status: CitationLawStatus;
  /** 給人看的說明（繁體中文）。 */
  summary: string;
  /** 期間內造成文字改變的修法日期（YYYY-MM-DD）。 */
  changeDates: string[];
}

function labelOf(ref: CitationRef): string {
  let s = `第${ref.article}條`;
  if (ref.paragraph !== undefined) s += `第${ref.paragraph}項`;
  if (ref.item !== undefined) s += `第${ref.item}款`;
  return s;
}

/**
 * 對照引用與沿革。
 * @param history 該法規的法條沿革（來自立法院）。
 * @param period 查詢期間（西元 YYYY-MM-DD）；未指定則比對全部版本。
 */
export function citationLawNotes(
  refs: CitationRef[],
  history: HistoryArticle[],
  period: { from?: string; to?: string } = {},
): CitationLawNote[] {
  return refs.map((ref) => {
    const label = labelOf(ref);
    const art = history.find((h) => h.article === ref.article);
    if (!art) {
      return {
        citation: label,
        article: ref.article,
        paragraph: ref.paragraph,
        item: ref.item,
        status: 'not_in_history' as const,
        summary: `${label}：法條沿革中查無此條，請人工確認條號。`,
        changeDates: [],
      };
    }
    const base = {
      citation: label,
      article: ref.article,
      paragraph: ref.paragraph,
      item: ref.item,
    };
    // 沒有指定期間時不做比對，只說明現行文字（避免把整部沿革的修法都算成查詢期間的異動）。
    if (!period.from && !period.to) {
      return {
        ...base,
        status: 'no_period' as const,
        summary: `${label}：未指定期間，僅列出現行文字，未比對修法沿革。`,
        changeDates: [],
      };
    }
    const r = periodReport(art, { ...period, paragraph: ref.paragraph, item: ref.item });
    if (r.endText === null && !r.baseline && r.versionsInPeriod.length === 0) {
      return {
        ...base,
        status: 'not_in_history' as const,
        summary: `${label}：沿革中查無此項或款，可能是條文經過修正後已變動項款。`,
        changeDates: [],
      };
    }
    if (!r.changed) {
      return {
        ...base,
        status: (period.from || period.to ? 'unchanged' : 'no_period') as CitationLawStatus,
        summary: period.from || period.to
          ? `${label}：查詢期間內文字未改變。`
          : `${label}：未指定期間，僅列出現行文字。`,
        changeDates: [],
      };
    }
    const dates = r.changes.map((c) => c.version.date as string);
    return {
      ...base,
      status: 'changed' as const,
      summary: `${label}：查詢期間內文字有異動（修正日期：${dates.join('、')}），判決引用時的條文可能與現行不同。`,
      changeDates: dates,
    };
  });
}
