// 匯出：列表 Excel（沿用轉型正義判決表的欄位順序）與單一判決 Word（摘要＋原文主文高亮）。
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ShadingType } from 'docx';
import type { JudgmentDetail, JudgmentSummary } from '@judge/core';

interface ListArgs {
  keyword: string;
  items: JudgmentSummary[];
  details: Record<string, { meta: JudgmentDetail['meta']; sections: Record<string, string>; fullText: string }>;
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
  if (hasFull) columns.push({ header: '主文', key: 'main', width: 60 }, { header: '全文字數', key: 'chars', width: 12 });
  ws.columns = columns;

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B5FD9' } };
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
    }
    const r = ws.addRow(row);
    r.alignment = { vertical: 'top', wrapText: true };
    if (i % 2 === 1) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6FB' } };
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

const para = (text: string, opts: { bold?: boolean; size?: number; highlight?: boolean } = {}) =>
  new Paragraph({
    spacing: { after: 120, line: 360 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: opts.size ?? 24,
        font: 'Microsoft JhengHei',
        ...(opts.highlight ? { shading: { type: ShadingType.CLEAR, fill: 'FFF3B0', color: 'auto' } } : {}),
      }),
    ],
  });

export async function buildBriefDocx(d: JudgmentDetail, summary: string | null): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: d.meta.title || d.meta.id, bold: true, size: 32, font: 'Microsoft JhengHei' })],
    }),
    para(`法院：${d.meta.court ?? '—'}　日期：${d.meta.dateIso ?? d.meta.dateMinguo}`),
    para(`案由：${d.meta.cause || '—'}`),
    para(`來源：${d.meta.sourceUrl}`, { size: 20 }),
    new Paragraph({ children: [new TextRun({ text: '' })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '一、摘要', bold: true, font: 'Microsoft JhengHei' })] }),
  ];
  if (summary) {
    summary.split(/\n+/).forEach((line) => children.push(para(line)));
  } else {
    children.push(para('（未產生 AI 摘要。可在設定中輸入 AI 金鑰後重新產生。）'));
  }
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '二、原文', bold: true, font: 'Microsoft JhengHei' })] }));
  for (const [name, body] of Object.entries(d.sections)) {
    children.push(para(name, { bold: true }));
    // 主文以黃色螢光標示，其餘段落為一般文字
    const highlight = name === '主文';
    body.split(/\n+/).filter(Boolean).forEach((line) => children.push(para(line, { highlight })));
  }
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
