// 現行法規（全國法規資料庫 law.moj.gov.tw）的 HTML 解析：條文、項、款。
// 頁面結構：div.law-reg-content 內，每條是 div.row；條號在 .col-no a（name 屬性為條號，例如 "191-3"）；
// 條文每一行是 .law-article 下的 div（class 為 line-XXXX）。
import * as cheerio from 'cheerio';
import { normalizeArticleNo, parseCitations } from './citation';
import { buildStructure, flattenStructure, selectSegment, type ParagraphNode } from './structure';

export interface CurrentArticle {
  /** 標準化條號，例如 "184"、"15-1"。 */
  article: string;
  /** 頁面上的條號文字，例如「第 15-1 條」。 */
  noText: string;
  /** 項與款的樹狀結構。 */
  paragraphs: ParagraphNode[];
}

export interface CurrentLaw {
  pcode: string;
  name: string | null;
  articles: CurrentArticle[];
}

const clean = (s: string) => s.replace(/ /g, ' ').replace(/　/g, ' ').replace(/\s+/g, ' ').trim();

/** 解析法規全文頁 LawAll.aspx 的 HTML。 */
export function parseCurrentLawHtml(html: string, pcode: string): CurrentLaw {
  const $ = cheerio.load(html);
  const name = clean($('#hlLawName').text() || $('h2').first().text()) || null;
  const articles: CurrentArticle[] = [];

  $('div.law-reg-content div.row').each((_, row) => {
    const $row = $(row);
    const $a = $row.find('.col-no a').first();
    const noText = clean($a.text());
    const article = normalizeArticleNo(noText);
    if (!article) return; // 章、節標題等非條文列

    const lines: string[] = [];
    $row.find('.law-article > div').each((__, div) => {
      const t = clean($(div).text());
      if (t) lines.push(t);
    });
    articles.push({ article, noText, paragraphs: buildStructure(lines) });
  });

  return { pcode, name, articles };
}

/** 取出某一條（可再指定項、款）的文字；找不到條號回傳 null。 */
export function currentArticleText(law: CurrentLaw, article: string, paragraph?: number, item?: number): string | null {
  const a = law.articles.find((x) => x.article === article);
  if (!a) return null;
  return selectSegment(a.paragraphs, paragraph, item);
}

/** 條文的平面文字行（項與款各一行）。 */
export function currentArticleLines(a: CurrentArticle): string[] {
  return flattenStructure(a.paragraphs);
}

/** 依判決引用的條文（例如「民法第184條第1項」），從現行條文取出對應段落；找不到時回傳 undefined（不猜）。 */
export function currentTextForCitations(law: CurrentLaw, cited: string[]): string | undefined {
  const parts: string[] = [];
  for (const ref of parseCitations(cited.join('；'))) {
    const text = currentArticleText(law, ref.article, ref.paragraph, ref.item);
    if (text) parts.push(`${ref.raw}：${text}`);
  }
  return parts.length ? parts.join('\n') : undefined;
}
