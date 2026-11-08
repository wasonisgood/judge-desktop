// 範圍整理表匯出（全部內容由 AI 產生）：
//   Excel：每部法規一個工作表（逐案 AI 分析欄位）＋每部法規一個「綜合分析」工作表。
//   Word：每部法規一段，先放 AI 綜合分析，再放逐案分析表。
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } from 'docx';
import type { ScopeRow, CaseAnalysis, ScopeSynthesis } from '@judge/core';

export interface ScopeSheet {
  statute: string;
  rows: ScopeRow[];
  analyses: CaseAnalysis[];
  synthesis: ScopeSynthesis | null;
}

const byId = (analyses: CaseAnalysis[]) => new Map(analyses.map((a) => [a.id, a]));

/** 逐案表的欄位（Excel 與 Word 共用順序）。 */
const CASE_HEADERS = ['序號', '裁判字號', '法院', '裁判日期', '案由', '類型（AI）', '爭點（AI）', '法院見解（AI）', '法規適用（AI）', '結論（AI）', '引用條文', '判決連結'];

function caseValues(i: number, r: ScopeRow, a: CaseAnalysis | undefined): string[] {
  return [
    String(i + 1),
    r.title,
    r.court ?? '',
    r.dateIso ?? '',
    r.cause,
    a?.group ?? '',
    a?.issue ?? '',
    a?.holding ?? '',
    a?.statuteApplication ?? '',
    a?.outcome ?? '',
    r.citedArticles.join('；'),
    r.href,
  ];
}

export async function buildScopeWorkbook(sheets: ScopeSheet[], meta: { yearFrom?: number; yearTo?: number }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '司法院裁判研究';
  wb.created = new Date();
  const widths = [6, 40, 16, 13, 28, 14, 36, 50, 40, 30, 30, 46];
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.statute.slice(0, 28));
    const map = byId(sh.analyses);
    ws.columns = CASE_HEADERS.map((h, i) => ({ header: h, key: 'c' + i, width: widths[i] }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    head.height = 24;
    sh.rows.forEach((r, i) => {
      const values = caseValues(i, r, map.get(r.id));
      const row = ws.addRow(Object.fromEntries(values.map((v, j) => ['c' + j, j === 11 ? { text: v, hyperlink: v } : v])));
      row.alignment = { vertical: 'top', wrapText: true };
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: { row: 1, column: CASE_HEADERS.length } };

    // 綜合分析工作表
    const syn = wb.addWorksheet(('綜合分析_' + sh.statute).slice(0, 28));
    syn.columns = [{ header: '項目', key: 'k', width: 16 }, { header: '內容（AI）', key: 'v', width: 110 }];
    syn.getRow(1).font = { bold: true };
    const s = sh.synthesis;
    if (s) {
      syn.addRow(['整體概述', s.overview]);
      syn.addRow(['趨勢與分歧', s.trends]);
      syn.addRow(['研究結論', s.conclusion]);
      for (const g of s.groups) {
        syn.addRow([`類型：${g.name}`, `${g.description}\n案件：${g.caseIds.join('、')}`]);
      }
    } else {
      syn.addRow(['說明', '本法規沒有找到引用的判決，因此沒有綜合分析。']);
    }
    syn.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
  }
  const info = wb.addWorksheet('說明');
  info.addRow(['範圍', sheets.map((s) => s.statute).join('、')]);
  info.addRow(['期間', `${meta.yearFrom ?? '不限'} 至 ${meta.yearTo ?? '不限'}`]);
  info.addRow(['產生時間', new Date().toLocaleString('zh-TW')]);
  info.addRow(['資料來源', '司法院裁判書查詢系統（公開資料）。逐案分析與綜合分析由 AI 產生，請對照原判決確認。']);
  info.getColumn(1).width = 12;
  info.getColumn(2).width = 80;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const font = 'Microsoft JhengHei';
const para = (text: string, size = 22, bold = false) =>
  new Paragraph({ spacing: { after: 100, line: 340 }, children: [new TextRun({ text, size, bold, font })] });

const cell = (text: string, bold = false) =>
  new TableCell({
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 16, font })] })],
  });

export async function buildScopeDocx(sheets: ScopeSheet[], meta: { yearFrom?: number; yearTo?: number }): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '範圍整理表', bold: true, size: 32, font })],
    }),
    para(`期間：${meta.yearFrom ?? '不限'} 至 ${meta.yearTo ?? '不限'}　產生時間：${new Date().toLocaleString('zh-TW')}`, 20),
    para('逐案分析與綜合分析由 AI 產生，請對照原判決確認。', 20),
  ];
  for (const sh of sheets) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `${sh.statute}（${sh.rows.length} 筆）`, bold: true, font })],
    }));
    const s = sh.synthesis;
    if (s) {
      children.push(para('綜合分析', 22, true));
      children.push(para(s.overview));
      children.push(para('趨勢與分歧：' + s.trends));
      children.push(para('研究結論：' + s.conclusion));
      if (s.groups.length) {
        children.push(para('類型整理', 22, true));
        for (const g of s.groups) children.push(para(`${g.name}：${g.description}（${g.caseIds.length} 筆）`));
      }
    } else {
      children.push(para('本法規沒有找到引用的判決，因此沒有綜合分析。'));
      continue;
    }
    children.push(para('逐案分析', 22, true));
    const map = byId(sh.analyses);
    const header = new TableRow({ tableHeader: true, children: CASE_HEADERS.map((c) => cell(c, true)) });
    const body = sh.rows.map((r, i) => new TableRow({
      children: caseValues(i, r, map.get(r.id)).map((v) => cell(v)),
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
