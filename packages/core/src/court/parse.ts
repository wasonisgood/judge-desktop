// 司法院頁面解析（純函數，可用固定 HTML 測試）。移植自 crawler.py 的 _parse_list_html、_parse_detail、_split_sections。
import * as cheerio from 'cheerio';
import { BASE } from './client';
import { cleanText, isoFromMinguo, reflowText } from '../text/normalize';

export interface JudgmentSummary {
  id: string;
  title: string;
  dateDisplay: string;
  dateIso: string | null;
  cause: string;
  href: string;
}

export interface JudgmentDetail {
  meta: {
    id: string;
    title: string;
    court: string | null;
    caseNo: string | null;
    judgmentType: string | null;
    dateMinguo: string;
    dateIso: string | null;
    cause: string;
    sourceUrl: string;
  };
  sections: Record<string, string>;
  history: { id: string | null; display: string; dateDisplay: string; href: string }[];
  relatedLaws: string[];
  fullText: string;
}

function idFromHref(href: string): string | null {
  try {
    return new URL(href, BASE).searchParams.get('id');
  } catch {
    return null;
  }
}

/** 列表頁：table#jud，第一列為表頭。 */
export function parseListHtml(html: string): JudgmentSummary[] {
  const $ = cheerio.load(html);
  const table = $('table#jud').first().length ? $('table#jud').first() : $('table.jub-table').first();
  const rows = table.find('tr').toArray().slice(1);
  const items: JudgmentSummary[] = [];
  for (const tr of rows) {
    const a = $(tr).find("a.hlTitle_scroll, a[href*='data.aspx?ty=JD']").first();
    if (!a.length) continue;
    const href = new URL(a.attr('href') ?? '', BASE).toString();
    const id = idFromHref(href);
    if (!id) continue;
    const tds = $(tr).find('td').toArray();
    const dateDisplay = tds.length >= 3 ? cleanText($(tds[2]).text()) : '';
    const cause = tds.length >= 4 ? cleanText($(tds[3]).text()) : '';
    items.push({
      id,
      title: cleanText(a.text()),
      dateDisplay,
      dateIso: isoFromMinguo(dateDisplay),
      cause,
      href,
    });
  }
  return items;
}

/** 法院選單（群組面板 data-group='jcourt'）。 */
export function parseCourtMenu(html: string): { code: string; label: string; count: number }[] {
  const $ = cheerio.load(html);
  const panel = $(".panel-body[data-group='jcourt']").first();
  const out: { code: string; label: string; count: number }[] = [];
  panel.find('li').each((_, li) => {
    const a = $(li).find("a[href*='qryresultlst.aspx']").first();
    if (!a.length) return;
    const badge = cleanText(a.find('.badge').text());
    let label = cleanText(a.text());
    if (badge) label = label.replace(new RegExp(`\\s*${badge}\\s*$`), '');
    label = label.replace(/\s+\S+$/, '').trim() || label;
    out.push({ code: a.attr('data-groupid') ?? '', label, count: /^\d+$/.test(badge) ? Number(badge) : -1 });
  });
  return out;
}

/** 依段落標題切分判決全文。 */
export function splitSections(fullText: string): Record<string, string> {
  if (!fullText) return { 內文: '' };
  const marks: [string, RegExp][] = [
    ['主文', /^\s*主\s*文\s*$/],
    ['事實及理由', /^\s*事\s*實\s*及\s*理\s*由\s*$/],
    ['理由', /^\s*理\s*由\s*$/],
    ['程序方面', /^\s*([壹一]\s*、)?\s*程\s*序\s*方\s*面\s*[:：]?\s*$/],
    ['實體方面', /^\s*([貳二]\s*、)?\s*實\s*體\s*方\s*面\s*[:：]?\s*$/],
    ['關於廢棄發回部分', /^\s*關於廢棄發回部分\s*[:：]?\s*$/],
    ['關於駁回上訴部分', /^\s*關於駁回上訴部分\s*[:：]?\s*$/],
    ['據上論結', /^\s*據\s*上\s*論\s*結\s*[:：]?\s*$/],
  ];
  const lines = fullText.split('\n').map((l) => l.replace(/\s+$/, ''));
  const found: [number, string][] = [];
  for (const [name, pat] of marks) {
    const idx = lines.findIndex((l) => pat.test(l));
    if (idx >= 0) found.push([idx, name]);
  }
  if (!found.length) return { 內文: fullText };
  found.sort((a, b) => a[0] - b[0]);

  const sections: Record<string, string> = {};
  const preface = lines.slice(0, found[0][0]).join('\n').trim();
  if (preface) sections['前置'] = preface;
  found.forEach(([start, name], i) => {
    const end = i + 1 < found.length ? found[i + 1][0] : lines.length;
    sections[name] = lines.slice(start + 1, end).join('\n').trim();
  });
  return sections;
}

/** 內頁：欄位在 #jud .row（.col-th 標籤、.col-td 值），全文在 pre 或 .text-pre。 */
export function parseDetailHtml(html: string, id: string, sourceUrl: string): JudgmentDetail {
  const $ = cheerio.load(html);
  const field = (label: string): string => {
    let value = '';
    $('#jud .row').each((_, row) => {
      const th = $(row).find('.col-th').first();
      const td = $(row).find('.col-td').first();
      if (th.length && td.length && th.text().includes(label)) {
        value = cleanText(td.text());
        return false;
      }
      return undefined;
    });
    return value;
  };

  // 正文段落是多個 div／p，直接 .text() 會黏在一起；先在區塊與換行處插入換行再取文字。
  let rawText = '';
  for (const sel of ['.jud_content .text-pre.text-pre-in', '.jud_content pre', '#jud .text-pre.text-pre-in', '#jud pre', '.text-pre', '.jud_content', '#jud', '.htmlcontent']) {
    const node = $(sel).first();
    if (!node.length) continue;
    node.find('br').replaceWith('\n');
    node.find('div, p, li, tr').each((_, el) => {
      $(el).append('\n');
    });
    const text = cleanText(node.text());
    if (text.length > 30) {
      rawText = text;
      break;
    }
  }
  const fullText = reflowText(rawText);

  const title = field('裁判字號');
  const dateMinguo = field('裁判日期');
  const cause = field('裁判案由');
  const m = /^(\S+法院)\s+(\d+)\s*年度\s*(\S+?)\s*字第\s*(\d+)\s*號\s*(判決|裁定)?/.exec(title);

  const history: JudgmentDetail['history'] = [];
  const hisLinks = $('#JudHis ul li a').length ? $('#JudHis ul li a') : $("a[href*='data.aspx?ty=JD']");
  hisLinks.each((_, a) => {
    const href = new URL($(a).attr('href') ?? '', BASE).toString();
    const display = cleanText($(a).text());
    const dm = /\((\d{2,3}\.\d{1,2}\.\d{1,2})\)$/.exec(display);
    history.push({ id: idFromHref(href), display, dateDisplay: dm?.[1] ?? '', href });
  });

  const relatedLaws = $('#JudrelaLaw ul.rela-law li').map((_, li) => cleanText($(li).text())).get();

  return {
    meta: {
      id,
      title,
      court: m?.[1] ?? null,
      caseNo: m ? `${m[2]}年度${m[3]}字第${m[4]}號` : null,
      judgmentType: m?.[5] ?? null,
      dateMinguo,
      dateIso: isoFromMinguo(dateMinguo),
      cause,
      sourceUrl,
    },
    sections: splitSections(fullText),
    history,
    relatedLaws,
    fullText,
  };
}
