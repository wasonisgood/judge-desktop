// 量化圖表的 Word 匯出（issue #8）：圖表以 PNG 嵌入，交叉表以原生表格輸出；來源說明與計數單位寫在圖（表）下方。
// 沿用 scopeExporters 的 docx 做法（不依賴 Electron，可直接以 node 測試）。
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType } from 'docx';

export interface ChartTableData {
  rowTitle: string;
  colTitle: string;
  rowLabels: string[];
  colLabels: string[];
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

export interface ChartDocxInput {
  title: string;
  /** 來源說明（以「｜」分隔的片段，每段一行）。 */
  note: string;
  unitLabel: string;
  /** 圖表的 PNG（非交叉表）。 */
  png?: Buffer | null;
  /** 交叉表資料（交叉表）。 */
  table?: ChartTableData | null;
}

/** 讀取 PNG 的像素寬高（IHDR 區塊）。不是 PNG 時拋錯。 */
export function pngSize(buf: Buffer): { width: number; height: number } {
  const sig = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== sig) throw new Error('不是 PNG 影像');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function crosstabTable(t: ChartTableData): Table {
  const cell = (text: string, bold = false) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })],
  });
  const header = new TableRow({
    tableHeader: true,
    children: [cell(`${t.rowTitle} ＼ ${t.colTitle}`, true), ...t.colLabels.map((c) => cell(c, true)), cell('合計', true)],
  });
  const body = t.rowLabels.map((r, i) => new TableRow({
    children: [
      cell(r, true),
      ...t.cells[i].map((v) => {
        const pct = t.rowTotals[i] ? ((v / t.rowTotals[i]) * 100).toFixed(1) : '0.0';
        return cell(`${v}（${pct}%）`);
      }),
      cell(String(t.rowTotals[i]), true),
    ],
  }));
  const foot = new TableRow({
    children: [cell('合計', true), ...t.colTotals.map((v) => cell(String(v), true)), cell(String(t.total), true)],
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body, foot] });
}

/** 單張圖表（或交叉表）的 Word 文件。 */
export async function buildChartDocx(input: ChartDocxInput): Promise<Buffer> {
  if (!input.png && !input.table) throw new Error('沒有可匯出的圖表內容');
  const children: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(input.title)] })];
  if (input.png) {
    const { width, height } = pngSize(input.png);
    // 以版面寬度 600px 為準等比縮放（Word 以像素計）。
    const w = 600;
    const h = Math.round((height / width) * w);
    children.push(new Paragraph({
      children: [new ImageRun({ type: 'png', data: input.png, transformation: { width: w, height: h } })],
    }));
  }
  if (input.table) children.push(crosstabTable(input.table));
  children.push(new Paragraph({ children: [new TextRun({ text: `計數單位：${input.unitLabel}`, size: 18 })] }));
  for (const line of input.note.split('｜').map((s) => s.trim()).filter(Boolean)) {
    children.push(new Paragraph({ children: [new TextRun({ text: line, size: 18, color: '57606A' })] }));
  }
  const doc = new Document({
    creator: '司法院裁判研究',
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

/** 畫面傳來的交叉表資料不可信：形狀與長度必須一致，否則丟棄。 */
export function sanitizeTable(raw: any): ChartTableData | null {
  if (!raw || typeof raw !== 'object') return null;
  const strs = (a: unknown): string[] | null => (Array.isArray(a) && a.every((x) => typeof x === 'string') ? a : null);
  const nums = (a: unknown): number[] | null => (Array.isArray(a) && a.every((x) => typeof x === 'number' && Number.isFinite(x)) ? a : null);
  const rowLabels = strs(raw.rowLabels);
  const colLabels = strs(raw.colLabels);
  const rowTotals = nums(raw.rowTotals);
  const colTotals = nums(raw.colTotals);
  if (!rowLabels || !colLabels || !rowTotals || !colTotals || typeof raw.total !== 'number') return null;
  if (!Array.isArray(raw.cells) || raw.cells.length !== rowLabels.length) return null;
  const cells: number[][] = [];
  for (const r of raw.cells) {
    const row = nums(r);
    if (!row || row.length !== colLabels.length) return null;
    cells.push(row);
  }
  if (rowTotals.length !== rowLabels.length || colTotals.length !== colLabels.length) return null;
  return {
    rowTitle: String(raw.rowTitle ?? '').slice(0, 120),
    colTitle: String(raw.colTitle ?? '').slice(0, 120),
    rowLabels, colLabels, cells, rowTotals, colTotals, total: raw.total,
  };
}

