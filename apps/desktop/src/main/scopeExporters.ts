// 範圍整理表匯出（全部內容由 AI 產生）：
//   Excel：每部法規一個工作表（逐案 AI 分析欄位）＋每部法規一個「綜合分析」工作表。
//   Word：每部法規一段，先放 AI 綜合分析，再放逐案分析表。
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, PageOrientation, TableLayoutType } from 'docx';
import type { ScopeRow, CaseAnalysis, ScopeSynthesis } from '@judge/core';

export interface ScopeSheet {
  statute: string;
  rows: ScopeRow[];
  analyses: CaseAnalysis[];
  synthesis: ScopeSynthesis | null;
  /** 案件類型篩選（有指定時）：類型與因字號而排除的筆數。 */
  caseType?: { type: string; excluded: number };
}

const byId = (analyses: CaseAnalysis[]) => new Map(analyses.map((a) => [a.id, a]));

/** 案件類型篩選的說明文字（匯出用）。 */
function caseTypeLine(sh: ScopeSheet): string | null {
  return sh.caseType ? `案件類型：${sh.caseType.type}（依判決字號篩選，排除 ${sh.caseType.excluded} 筆）` : null;
}

/** 逐案表的欄位（Excel 與 Word 共用順序）。 */
// 字號類型放在最後一欄：既有欄位的位置不變（其他匯出與測試以欄位位置讀取）。
const CASE_HEADERS = ['序號', '裁判字號', '法院', '裁判日期', '案由', '類型（AI）', '爭點（AI）', '法院見解（AI）', '法規適用（AI）', '結論（AI）', '引用條文', '法條異動（依沿革比對）', '歷審位置（司法院清單）', '判決連結', '字號類型'];

/** 判決連結所在欄（Excel 以超連結呈現）。 */
const HREF_COL = CASE_HEADERS.indexOf('判決連結');

/** Excel 欄寬（字元單位），與 CASE_HEADERS 一一對應。 */
const CASE_WIDTHS = [6, 40, 16, 13, 28, 14, 36, 50, 40, 30, 30, 46, 40, 30, 10];

/** Excel 工作表名稱：不得含 : \ / ? * [ ]，最長 31 字；同名時加上序號。 */
function uniqueSheetName(raw: string, used: Set<string>): string {
  const clean = raw.replace(/[:\\/?*\[\]]/g, '·').trim() || '工作表';
  let base = clean.slice(0, 28);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 28 - String(n).length - 1)}_${n++}`;
  used.add(name.toLowerCase());
  return name;
}

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
    (r.lawNotes ?? []).map((n) => n.summary).join('\n'),
    r.historyPosition ?? '',
    r.href,
    r.caseTypeLabel ?? '',
  ];
}

export async function buildScopeWorkbook(sheets: ScopeSheet[], meta: { yearFrom?: number; yearTo?: number }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '司法院裁判研究';
  wb.created = new Date();
  const widths = CASE_WIDTHS;
  const usedNames = new Set<string>();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(uniqueSheetName(sh.statute, usedNames));
    const map = byId(sh.analyses);
    ws.columns = CASE_HEADERS.map((h, i) => ({ header: h, key: 'c' + i, width: widths[i] }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    head.height = 24;
    sh.rows.forEach((r, i) => {
      const values = caseValues(i, r, map.get(r.id));
      const row = ws.addRow(Object.fromEntries(values.map((v, j) => ['c' + j, j === HREF_COL ? { text: v, hyperlink: v } : v])));
      row.alignment = { vertical: 'top', wrapText: true };
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: { row: 1, column: CASE_HEADERS.length } };

    // 綜合分析工作表
    const syn = wb.addWorksheet(uniqueSheetName('綜合分析_' + sh.statute, usedNames));
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
  for (const sh of sheets) {
    const line = caseTypeLine(sh);
    if (line) info.addRow([sh.statute, line]);
  }
  info.addRow(['產生時間', new Date().toLocaleString('zh-TW')]);
  info.addRow(['資料來源', '司法院裁判書查詢系統（公開資料）。逐案分析與綜合分析由 AI 產生，請對照原判決確認。']);
  info.getColumn(1).width = 12;
  info.getColumn(2).width = 80;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const font = 'Microsoft JhengHei';
const para = (text: string, size = 22, bold = false) =>
  new Paragraph({ spacing: { after: 100, line: 340 }, children: [new TextRun({ text, size, bold, font })] });

/** 橫式 A4、邊界 2 公分時的可用寬度（twips）。 */
const LANDSCAPE_TEXT_WIDTH = 16838 - 2 * 1134;

/** 每欄最小寬度（twips，約 0.9 公分），避免序號等窄欄的文字被擠成直排。 */
const DOCX_MIN_COL = 510;

/** 每欄先保留最小寬度，其餘寬度依 Excel 欄寬比例分配；總和等於版面可用寬度。 */
function docxColumnWidths(): number[] {
  const total = CASE_WIDTHS.reduce((a, b) => a + b, 0);
  const free = LANDSCAPE_TEXT_WIDTH - DOCX_MIN_COL * CASE_WIDTHS.length;
  const w = CASE_WIDTHS.map((x) => DOCX_MIN_COL + Math.floor((x / total) * free));
  w[w.length - 1] += LANDSCAPE_TEXT_WIDTH - w.reduce((a, b) => a + b, 0);
  return w;
}

/** 儲存格：每一行獨立成段（Word 的文字 run 不會把換行符號轉成換行）。 */
const cell = (text: string, width: number, bold = false) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: (text || ' ').split('\n').map((line) =>
      new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: line, bold, size: 16, font })] })),
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
    const typeLine = caseTypeLine(sh);
    if (typeLine) children.push(para(typeLine, 20));
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
    const colW = docxColumnWidths();
    const header = new TableRow({ tableHeader: true, children: CASE_HEADERS.map((c, j) => cell(c, colW[j], true)) });
    const body = sh.rows.map((r, i) => new TableRow({
      cantSplit: false,
      children: caseValues(i, r, map.get(r.id)).map((v, j) => cell(v, colW[j])),
    }));
    children.push(new Table({
      width: { size: LANDSCAPE_TEXT_WIDTH, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: colW,
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
  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      children,
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
