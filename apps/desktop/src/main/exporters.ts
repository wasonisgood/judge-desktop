// 匯出：列表 Excel（沿用轉型正義判決表的欄位順序）與單一判決精讀 Word（全部段落由 AI 整理，原判決主文以螢光標示）。
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ShadingType, BorderStyle } from 'docx';
import type { JudgmentDetail, JudgmentSummary, BriefDocument, Annotation, HighlightColor } from '@judge/core';
import { segmentText, DEFAULT_COLOR_LABELS } from '@judge/core';

interface ListArgs {
  keyword: string;
  items: JudgmentSummary[];
  details: Record<string, { meta: JudgmentDetail['meta']; sections: Record<string, string>; fullText: string; historyPosition?: string }>;
}

export async function buildListWorkbook(args: ListArgs): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '司法院裁判研究';
  wb.created = new Date();
  const ws = wb.addWorksheet('判決列表');
  const hasFull = Object.keys(args.details).length > 0;
  const columns: Partial<ExcelJS.Column>[] = [
    { header: '序號', key: 'no', width: 6 },
    { header: '裁判字號', key: 'title', width: 42 },
    { header: '裁判日期', key: 'date', width: 14 },
    { header: '案由', key: 'cause', width: 36 },
    { header: '法院', key: 'court', width: 18 },
    { header: '判決連結', key: 'href', width: 50 },
  ];
  if (hasFull) columns.push({ header: '主文', key: 'main', width: 60 }, { header: '全文字數', key: 'chars', width: 12 }, { header: '歷審位置（司法院清單）', key: 'history', width: 48 });
  ws.columns = columns;

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB9472B' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 22;

  args.items.forEach((it, i) => {
    const d = args.details[it.id];
    const row: Record<string, unknown> = {
      no: i + 1,
      title: it.title,
      date: it.dateIso ?? it.dateDisplay,
      cause: it.cause,
      court: d?.meta.court ?? '',
      href: { text: it.href, hyperlink: it.href },
    };
    if (hasFull) {
      row.main = d ? (d.sections['主文'] ?? '') : '';
      row.chars = d ? d.fullText.length : 0;
      row.history = d ? (d.historyPosition ?? '') : '';
    }
    const r = ws.addRow(row);
    r.alignment = { vertical: 'top', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };

  const info = wb.addWorksheet('搜尋資訊');
  info.addRow(['關鍵字', args.keyword]);
  info.addRow(['筆數', args.items.length]);
  info.addRow(['產生時間', new Date().toLocaleString('zh-TW')]);
  info.addRow(['資料來源', '司法院裁判書查詢系統（公開資料）']);
  info.getColumn(1).width = 14;
  info.getColumn(2).width = 60;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

const font = 'Microsoft JhengHei';
const para = (text: string, opts: { bold?: boolean; size?: number; highlight?: boolean } = {}) =>
  new Paragraph({
    spacing: { after: 120, line: 360 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: opts.size ?? 24,
        font,
        ...(opts.highlight ? { shading: { type: ShadingType.CLEAR, fill: 'F3D9CC', color: 'auto' } } : {}),
      }),
    ],
  });

/** 單一判決精讀：標題與基本資料之後，依 AI 整理的段落輸出；最後附原判決主文（螢光標示）。 */
export async function buildBriefDocx(d: JudgmentDetail, doc: BriefDocument): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: doc.title || d.meta.title || d.meta.id, bold: true, size: 32, font })],
    }),
    para(`法院：${d.meta.court ?? '—'}　日期：${d.meta.dateIso ?? d.meta.dateMinguo}`),
    para(`案由：${d.meta.cause || '—'}`),
    para(`歷審：${d.historyPosition?.summary ?? '—'}`),
    para(`來源：${d.meta.sourceUrl}`, { size: 20 }),
    para('以下內容由 AI 依判決原文整理，請對照原文確認。', { size: 20 }),
  ];
  for (const sec of doc.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sec.heading, bold: true, font })] }));
    for (const p of sec.paragraphs) children.push(para(p));
  }
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '原判決主文', bold: true, font })] }));
  const main = d.sections['主文'] ?? '';
  main.split(/\n+/).filter(Boolean).forEach((line) => children.push(para(line, { highlight: true })));
  const document = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(document));
}

/** 螢光底色（與畫面一致）。Word 以字元底色（w:shd）保留。 */
export const HIGHLIGHT_FILL: Record<HighlightColor, string> = { yellow: 'FFF176', green: 'A5D6A7', pink: 'F8BBD0', blue: '90CAF9' };

export interface AnnotatedCase {
  meta: { title: string; caseNo?: string | null; court?: string | null; dateIso?: string | null; dateMinguo?: string; cause?: string; sourceUrl?: string };
  fullText: string;
  /** 對位狀態為 ok 的標注（會在原文中標示）。 */
  annotations: Annotation[];
  /** 需重新對位的標注（不在原文中標示，另列於該案最後）。 */
  stale?: Annotation[];
}

export type ColorLabelMap = Record<HighlightColor, string>;

const EXCERPT_CHARS = 60;
const excerpt = (s: string) => (s.length > EXCERPT_CHARS ? `${s.slice(0, EXCERPT_CHARS)}…` : s);

/** 單一案件的段落區塊。multi 為 true 時以案件標題開頭，並在區塊前分頁。 */
function caseBlocks(c: AnnotatedCase, labels: ColorLabelMap, multi: boolean): Paragraph[] {
  const m = c.meta;
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      pageBreakBefore: multi,
      children: [new TextRun({ text: m.title || '判決筆記', bold: true, size: 32, font })],
    }),
    para(`法院：${m.court ?? '—'}　日期：${m.dateIso ?? m.dateMinguo ?? '—'}　字號：${m.caseNo ?? '—'}`),
    para(`案由：${m.cause || '—'}`),
    para(`來源：${m.sourceUrl ?? '—'}`, { size: 20 }),
  ];
  // 顏色說明：每色一個示範色塊（使用本案使用的顏色名稱）。
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: '螢光顏色：', size: 20, font })].concat(
      (Object.keys(HIGHLIGHT_FILL) as HighlightColor[]).flatMap((col) => [
        new TextRun({ text: `　${labels[col]}　`, size: 20, font, shading: { type: ShadingType.CLEAR, fill: HIGHLIGHT_FILL[col], color: 'auto' } }),
        new TextRun({ text: ' ', size: 20, font }),
      ]),
    ),
  }));
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '判決全文', bold: true, font })] }));

  // 全文依換行切段；標注片段以字元底色輸出，段落後附該段內的註解。
  const text = c.fullText;
  const annotations = c.annotations;
  const lines: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const raw of text.split('\n')) {
    lines.push({ start: cursor, end: cursor + raw.length });
    cursor += raw.length + 1;
  }
  const lineOf = (pos: number): number => {
    let lo = 0, hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].start <= pos) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const notesByLine = new Map<number, Annotation[]>();
  for (const a of annotations.filter((x) => x.mode === 'highlight_note' && x.note.trim())) {
    const li = lineOf(a.end - 1);
    notesByLine.set(li, [...(notesByLine.get(li) ?? []), a]);
  }
  const segments = segmentText(text, annotations);
  lines.forEach((ln, i) => {
    if (ln.end > ln.start) {
      const runs: TextRun[] = [];
      for (const seg of segments) {
        if (seg.end <= ln.start || seg.start >= ln.end) continue;
        const s = Math.max(seg.start, ln.start), e = Math.min(seg.end, ln.end);
        runs.push(new TextRun({
          text: text.slice(s, e),
          size: 24,
          font,
          ...(seg.color ? { shading: { type: ShadingType.CLEAR, fill: HIGHLIGHT_FILL[seg.color], color: 'auto' } } : {}),
        }));
      }
      if (runs.length === 0) runs.push(new TextRun({ text: text.slice(ln.start, ln.end), size: 24, font }));
      children.push(new Paragraph({ spacing: { after: 120, line: 360 }, children: runs }));
    }
    for (const a of notesByLine.get(i) ?? []) children.push(noteParagraph(a, labels));
  });

  const stale = c.stale ?? [];
  if (stale.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '需重新對位的註解', bold: true, font })] }));
    children.push(para('以下標注所在的全文已變動，無法確定位置，未套用於上方原文。', { size: 20 }));
    for (const a of stale) children.push(noteParagraph(a, labels));
  }
  return children;
}

/**
 * 個案研究筆記（單案）Word：案件資訊、顏色說明、判決全文（螢光以字元底色保留），
 * 註解附在其標注所在段落之後；全文已變動而無法對位的註解另列於最後。
 */
export async function buildAnnotatedDocx(c: AnnotatedCase, labels: ColorLabelMap = DEFAULT_COLOR_LABELS): Promise<Buffer> {
  const document = new Document({ sections: [{ children: caseBlocks(c, labels, false) }] });
  return Buffer.from(await Packer.toBuffer(document));
}

/** 多案合併 Word：每案獨立一個區塊（分頁），各自保留螢光、註解與需重新對位的註解。 */
export async function buildAnnotatedCasesDocx(cases: AnnotatedCase[], labels: ColorLabelMap = DEFAULT_COLOR_LABELS): Promise<Buffer> {
  if (cases.length === 0) throw new Error('沒有可匯出的案件');
  const children = cases.flatMap((c, i) => caseBlocks(c, labels, i > 0));
  const document = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(document));
}

function noteParagraph(a: Annotation, labels: ColorLabelMap): Paragraph {
  const label = labels[a.color];
  return new Paragraph({
    indent: { left: 480 },
    spacing: { after: 160 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: HIGHLIGHT_FILL[a.color], space: 6 } },
    children: [
      new TextRun({ text: `註解（${label}）：`, bold: true, size: 20, font }),
      new TextRun({ text: a.note, size: 20, font }),
      new TextRun({ text: `　標注文字：「${excerpt(a.quote)}」`, size: 18, font, color: '666666' }),
    ],
  });
}
