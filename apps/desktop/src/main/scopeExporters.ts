// 範圍整理表匯出：Excel（每個法規一個工作表）與 Word（每個法規一段標題加一張表）。
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } from 'docx';
import type { ScopeRow } from '@judge/core';

export interface ScopeSheet {
  statute: string;
  rows: ScopeRow[];
}

const COLS = ['序號', '裁判字號', '法院', '裁判日期', '案由', '主文（結果）', '引用條文', '判決連結'];

export async function buildScopeWorkbook(sheets: ScopeSheet[], meta: { yearFrom?: number; yearTo?: number }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '司法院裁判研究';
  wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.statute.slice(0, 28));
    ws.columns = [
      { header: COLS[0], key: 'no', width: 6 },
      { header: COLS[1], key: 'title', width: 40 },
      { header: COLS[2], key: 'court', width: 16 },
      { header: COLS[3], key: 'date', width: 13 },
      { header: COLS[4], key: 'cause', width: 30 },
      { header: COLS[5], key: 'result', width: 50 },
      { header: COLS[6], key: 'cited', width: 36 },
      { header: COLS[7], key: 'href', width: 48 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.alignment = { vertical: 'middle', horizontal: 'center' };
    head.height = 22;
    sh.rows.forEach((r, i) => {
      const row = ws.addRow({
        no: i + 1,
        title: r.title,
        court: r.court ?? '',
        date: r.dateIso ?? '',
        cause: r.cause,
        result: r.result,
        cited: r.citedArticles.join('；'),
        href: { text: r.href, hyperlink: r.href },
      });
      row.alignment = { vertical: 'top', wrapText: true };
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: { row: 1, column: COLS.length } };
  }
  const info = wb.addWorksheet('說明');
  info.addRow(['範圍', sheets.map((s) => s.statute).join('、')]);
  info.addRow(['期間', `${meta.yearFrom ?? '不限'} 至 ${meta.yearTo ?? '不限'}`]);
  info.addRow(['產生時間', new Date().toLocaleString('zh-TW')]);
  info.addRow(['資料來源', '司法院裁判書查詢系統（公開資料）']);
  info.getColumn(1).width = 12;
  info.getColumn(2).width = 70;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cell = (text: string, bold = false) =>
  new TableCell({
    width: { size: 0, type: WidthType.AUTO },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold, size: 19, font: 'Microsoft JhengHei' })],
      }),
    ],
  });

export async function buildScopeDocx(sheets: ScopeSheet[], meta: { yearFrom?: number; yearTo?: number }): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '範圍整理表', bold: true, size: 32, font: 'Microsoft JhengHei' })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `期間：${meta.yearFrom ?? '不限'} 至 ${meta.yearTo ?? '不限'}　產生時間：${new Date().toLocaleString('zh-TW')}`, size: 20, font: 'Microsoft JhengHei' })],
    }),
  ];
  for (const sh of sheets) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `${sh.statute}（${sh.rows.length} 筆）`, bold: true, font: 'Microsoft JhengHei' })],
    }));
    const header = new TableRow({ tableHeader: true, children: COLS.slice(0, 7).map((c) => cell(c, true)) });
    const body = sh.rows.map((r, i) => new TableRow({
      children: [
        cell(String(i + 1)),
        cell(r.title),
        cell(r.court ?? ''),
        cell(r.dateIso ?? ''),
        cell(r.cause),
        cell(r.result),
        cell(r.citedArticles.join('；')),
      ],
    }));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
        left: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
        right: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'BBBBBB' },
        insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'BBBBBB' },
      },
      rows: [header, ...body],
    }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
