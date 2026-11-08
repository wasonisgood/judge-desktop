// 法條沿革（立法院法律系統 lis.ly.gov.tw）的 HTML 解析：每一條的歷次修法版本。
// 頁面結構：font.artino 為條號（第X條）；同一區塊內 font.upddate 為「(ROC日期 制定／修正)」，
// td.artiupd_TH_2 為條文（段落以 <br> 分隔），td.artiupd_RS_2 為立法或修法理由。
import * as cheerio from 'cheerio';
import { normalizeArticleNo } from './citation';

export interface HistoryVersion {
  /** 施行或公布的西元日期（YYYY-MM-DD）；無法解析時為 null。 */
  date: string | null;
  /** 制定、修正、增訂等種類。 */
  kind: string;
  /** 條文全文，項與款各占一行。 */
  text: string;
  /** 理由。 */
  reason: string;
}

export interface HistoryArticle {
  article: string;
  noText: string;
  /** 依日期由舊到新排序。 */
  versions: HistoryVersion[];
}

const nbspClean = (s: string) => s.replace(/ /g, ' ').replace(/　/g, ' ');

/** 「(0690620 制定)」→ { date: "1980-06-20", kind: "制定" }。 */
export function parseRocDateLabel(raw: string): { date: string | null; kind: string } {
  const s = nbspClean(raw).replace(/[()（）]/g, '').trim();
  const m = /^(\d{6,7})\s*(.*)$/.exec(s);
  if (!m) return { date: null, kind: s };
  const digits = m[1];
  const year = Number(digits.slice(0, digits.length - 4)) + 1911;
  const month = digits.slice(-4, -2);
  const day = digits.slice(-2);
  return { date: `${year}-${month}-${day}`, kind: m[2].trim() };
}

/** 條文 HTML（以 <br> 分段）轉成純文字，每段一行。 */
function htmlToLines(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n');
  const text = cheerio.load(`<div>${withBreaks}</div>`)('div').text();
  return nbspClean(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** 解析法條沿革頁。 */
export function parseLawHistoryHtml(html: string): HistoryArticle[] {
  const $ = cheerio.load(html);
  const out: HistoryArticle[] = [];

  $('font.artino').each((_, el) => {
    const noText = nbspClean($(el).text()).trim();
    const article = normalizeArticleNo(noText);
    if (!article) return;
    const $block = $(el).closest('table');

    const dates = $block.find('font.upddate').map((__, f) => $(f).text()).get();
    const texts = $block.find('td.artiupd_TH_2').map((__, td) => htmlToLines($(td).html() ?? '')).get();
    const reasons = $block.find('td.artiupd_RS_2').map((__, td) => htmlToLines($(td).html() ?? '')).get();

    const n = Math.max(dates.length, texts.length, reasons.length);
    const versions: HistoryVersion[] = [];
    for (let i = 0; i < n; i++) {
      const { date, kind } = parseRocDateLabel(dates[i] ?? '');
      versions.push({ date, kind, text: texts[i] ?? '', reason: reasons[i] ?? '' });
    }
    versions.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    out.push({ article, noText, versions });
  });

  return out;
}
