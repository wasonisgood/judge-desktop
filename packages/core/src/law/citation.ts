// 條號與條文引用的解析：中文數字與阿拉伯數字互換、之一／-1 等枝節條號、第 N 項、第 N 款。
// 精確到「條、項、款」；款以「一、二、…」的中文數字標示，項以「第 N 項」或段落順序標示。

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 全形數字轉半形。 */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

/**
 * 中文或阿拉伯數字轉整數。
 * 支援：「十五」「二十一」「一百零五」「184」「１８４」。無法辨識時回傳 null。
 */
export function numberFromText(raw: string): number | null {
  const t = toHalfWidth(raw.trim().replace(/\s+/g, ''));
  if (!t) return null;
  if (/^[0-9]+$/.test(t)) return Number(t);
  let total = 0;
  let num = 0;
  let seen = false;
  for (const ch of t) {
    if (ch in CN_DIGIT) {
      num = CN_DIGIT[ch];
      seen = true;
    } else if (ch in CN_UNIT) {
      total += (num || 1) * CN_UNIT[ch];
      num = 0;
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? total + num : null;
}

/**
 * 條號標準化為「數字」或「數字-枝號」：「第一百八十四條之一」→「184-1」、「第 191-3 條」→「191-3」、「15之1」→「15-1」。
 * 無法辨識時回傳 null。
 */
export function normalizeArticleNo(raw: string): string | null {
  let s = toHalfWidth(raw.replace(/\s+/g, ''));
  s = s.replace(/^第/, '');
  // 「第一百八十四條之一」的「之一」寫在「條」後面，要把條後面的「之X」一起接回來。
  const cut = s.indexOf('條');
  if (cut >= 0) {
    const head = s.slice(0, cut);
    const tail = s.slice(cut + 1).match(/^((?:之[0-9一二三四五六七八九十百千零〇兩]+)*)/)?.[1] ?? '';
    s = head + tail;
  }
  if (!s) return null;
  const parts = s.split(/之|-/).map((p) => numberFromText(p));
  if (parts.some((p) => p === null)) return null;
  return parts.join('-');
}

export interface CitationRef {
  /** 標準化條號，例如 "184"、"191-3"。 */
  article: string;
  /** 項（段落）序號；未指定為 undefined。 */
  paragraph?: number;
  /** 款序號；未指定為 undefined。 */
  item?: number;
  /** 原始文字。 */
  raw: string;
}

const NUM = '[0-9０-９一二三四五六七八九十百千零〇兩]+';
// 第 <條號> 條 [之<枝號>…] [第 N 項] [第 N 款]
// 條號本體可用「-」（如 191-3 條）；「之」只出現在「條」後面（如 第184條之1）。
const ARTICLE_RE = new RegExp(
  `第\\s*(${NUM}(?:\\s*-\\s*${NUM})*)\\s*條` +
    `((?:\\s*之\\s*${NUM})*)` +
    `(?:\\s*第\\s*(${NUM})\\s*項)?` +
    `(?:\\s*第\\s*(${NUM})\\s*款)?`,
  'g',
);

/** 從一段文字（例如判決的相關法條欄或理由文字）找出所有「第 N 條（第 N 項、第 N 款）」引用。 */
export function parseCitations(text: string): CitationRef[] {
  const out: CitationRef[] = [];
  for (const m of text.matchAll(ARTICLE_RE)) {
    const article = normalizeArticleNo(m[1] + '條' + (m[2] ?? '').replace(/\s+/g, ''));
    if (!article) continue;
    const ref: CitationRef = { article, raw: m[0].replace(/\s+/g, '') };
    if (m[3]) {
      const p = numberFromText(m[3]);
      if (p !== null) ref.paragraph = p;
    }
    if (m[4]) {
      const i = numberFromText(m[4]);
      if (i !== null) ref.item = i;
    }
    out.push(ref);
  }
  return out;
}

/** 把使用者輸入的條文（例如「民法第184條第1項第2款」「第一百八十四條之一」）解析為引用。 */
export function parseSingleCitation(input: string): CitationRef | null {
  const refs = parseCitations(input);
  return refs.length ? refs[0] : null;
}

/** 款的起首標記：「一、」「十二、」。 */
const ITEM_HEAD_RE = /^[一二三四五六七八九十百]+、/;
/** 目的起首標記：「（一）」。 */
const SUBITEM_HEAD_RE = /^[（(][一二三四五六七八九十百0-9]+[）)]/;

/** 款號（「一、」→1）。 */
export function itemNumberOf(line: string): number | null {
  const m = /^([一二三四五六七八九十百]+)、/.exec(line.trim());
  return m ? numberFromText(m[1]) : null;
}

export { ITEM_HEAD_RE, SUBITEM_HEAD_RE };
