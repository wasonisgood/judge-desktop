// 原版判決 PDF 排版成 Word：每一份 Word 放 4 頁原版頁面（2×2 格），AI 引用的原文以螢光色標示。
import { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, PageOrientation } from 'docx';

export interface PageImage {
  pageNo: number;
  png: Buffer;
  widthPx: number;
  heightPx: number;
  highlighted: number;
}

const font = 'Microsoft JhengHei';
/** A4 直式、邊界 1.5 公分；每格約 8.5 公分寬。 */
const CELL_WIDTH_CM = 8.6;
const PX_PER_CM = 96 / 2.54;

/** 把頁面依每 4 頁分組；回傳每一組（一份 Word）。 */
export function groupPages<T>(items: T[], size = 4): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface BriefSummary {
  title: string;
  sections: { heading: string; paragraphs: string[] }[];
}

/** 一份 Word：（僅第一份）先放 AI 精讀摘要，然後是 2×2 的頁面格，每格下方標註頁碼。 */
export async function buildFourPerPageDocx(pages: PageImage[], title: string, summary?: BriefSummary): Promise<Buffer> {
  const cellWpx = Math.round(CELL_WIDTH_CM * PX_PER_CM);
  const cells: TableCell[] = [];
  const slots = [...pages];
  while (slots.length < 4) slots.push(null as unknown as PageImage);
  for (const p of slots) {
    if (!p) {
      cells.push(new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [new Paragraph('')] }));
      continue;
    }
    const h = Math.round(cellWpx * (p.heightPx / p.widthPx));
    cells.push(new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      borders: noBorders(),
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: 'png', data: p.png, transformation: { width: cellWpx, height: h } })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `第 ${p.pageNo} 頁${p.highlighted ? `（標示 ${p.highlighted} 處）` : ''}`, size: 18, font, color: '666666' })],
        }),
      ],
    }));
  }
  const rows: TableRow[] = [new TableRow({ children: [cells[0], cells[1]] }), new TableRow({ children: [cells[2], cells[3]] })];
  const doc = new Document({
    sections: [{
      properties: {
        page: { size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, margin: { top: 850, bottom: 850, left: 850, right: 850 } },
      },
      children: [
        new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: title, bold: true, size: 22, font })] }),
        new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: '原版判決頁面；黃色螢光為 AI 整理時引用的原文。', size: 18, font, color: '666666' })] }),
        ...summaryParagraphs(summary),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noTableBorders(), rows }),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** AI 精讀摘要（註明為 AI 整理，內容以原判決為準）。 */
function summaryParagraphs(summary?: BriefSummary): Paragraph[] {
  if (!summary || summary.sections.length === 0) return [];
  const out: Paragraph[] = [
    new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: 'AI 精讀摘要', bold: true, size: 24, font })] }),
    new Paragraph({ children: [new TextRun({ text: '以下內容由 AI 依判決原文整理，請對照下方原版頁面（黃色螢光）確認。', size: 18, font, color: '666666' })] }),
  ];
  for (const sec of summary.sections) {
    out.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: sec.heading, bold: true, size: 20, font })] }));
    for (const para of sec.paragraphs) out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: para, size: 20, font })] }));
  }
  out.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: '', size: 8, font })] }));
  return out;
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: none, bottom: none, left: none, right: none };
}
function noTableBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
}
