// 條文的「項／款」結構：把一條條文的行切成段落（項），段落底下再切成款。
// 規則：不以「一、」或「（一）」開頭的行是新的項；以「一、」開頭的行是款，歸屬於前一個項；
// 以「（一）」開頭的行是目，接在前一個款後面。項與款的序號依出現順序計算。
import { ITEM_HEAD_RE, SUBITEM_HEAD_RE, itemNumberOf } from './citation';

export interface ItemNode {
  /** 款序號（一、→1）。 */
  no: number | null;
  /** 款全文（含目）。 */
  text: string;
}

export interface ParagraphNode {
  /** 項序號，從 1 開始，依出現順序。 */
  no: number;
  /** 項全文（不含款）。 */
  text: string;
  items: ItemNode[];
}

/** 把已經切好行的條文轉成項與款。空行會被略過。 */
export function buildStructure(lines: string[]): ParagraphNode[] {
  const paragraphs: ParagraphNode[] = [];
  let currentItem: ItemNode | null = null;

  const ensureParagraph = (): ParagraphNode => {
    if (paragraphs.length === 0) paragraphs.push({ no: 1, text: '', items: [] });
    return paragraphs[paragraphs.length - 1];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (ITEM_HEAD_RE.test(line)) {
      const para = ensureParagraph();
      currentItem = { no: itemNumberOf(line), text: line };
      para.items.push(currentItem);
    } else if (SUBITEM_HEAD_RE.test(line) && currentItem) {
      currentItem.text += '\n' + line;
    } else {
      // 一般段落：新的項。
      paragraphs.push({ no: paragraphs.length + 1, text: line, items: [] });
      currentItem = null;
    }
  }
  return paragraphs;
}

/** 把一條條文轉成純文字行（項與款各自一行），供比對與顯示。 */
export function flattenStructure(paragraphs: ParagraphNode[]): string[] {
  const out: string[] = [];
  for (const p of paragraphs) {
    out.push(p.text);
    for (const it of p.items) out.push(...it.text.split('\n'));
  }
  return out;
}

/**
 * 取出指定項（與款）的文字。
 * - 只指定條：回傳全文。
 * - 指定項：回傳該項全文（含其下各款）。
 * - 指定項與款：回傳該款文字。找不到回傳 null。
 */
export function selectSegment(
  paragraphs: ParagraphNode[],
  paragraph?: number,
  item?: number,
): string | null {
  if (paragraph === undefined) {
    return paragraphs.map((p) => [p.text, ...p.items.map((i) => i.text)].join('\n')).join('\n');
  }
  const para = paragraphs.find((p) => p.no === paragraph);
  if (!para) return null;
  if (item === undefined) return [para.text, ...para.items.map((i) => i.text)].join('\n');
  const it = para.items.find((i) => i.no === item);
  return it ? it.text : null;
}
