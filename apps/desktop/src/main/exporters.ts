// 匯出：列表 Excel（沿用轉型正義判決表的欄位順序）與單一判決精讀 Word（全部段落由 AI 整理，原判決主文以螢光標示）。
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ShadingType } from 'docx';
import type { JudgmentDetail, JudgmentSummary, BriefDocument } from '@judge/core';

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
