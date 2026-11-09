// 匯出：納入／排除核查結果（核查結果：每案一列、每條標準一欄；依據原文：每案每條一列；核查資訊）。
import ExcelJS from 'exceljs';
import { toCriteriaTable, type CriteriaRun } from '@judge/core';
import { evidenceRows } from './services/criteriaLogic';

function styleHeader(ws: ExcelJS.Worksheet): void {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB9472B' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function buildCriteriaWorkbook(run: CriteriaRun): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '司法院裁判研究';
  wb.created = new Date();

  const { headers, rows } = toCriteriaTable(run);
  const main = wb.addWorksheet('核查結果');
  main.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: i < 4 ? 14 : 44 }));
  rows.forEach((r) => {
    const row = main.addRow(Object.fromEntries(r.map((v, i) => [`c${i}`, v])));
    row.alignment = { vertical: 'top', wrapText: true };
  });
  styleHeader(main);

  const ev = wb.addWorksheet('依據原文');
  ev.columns = [
    { header: '案號', key: 'a', width: 28 },
    { header: '標準', key: 'b', width: 30 },
    { header: '判斷方式', key: 'c', width: 12 },
    { header: '判定', key: 'd', width: 12 },
    { header: '依據說明', key: 'e', width: 44 },
    { header: '逐字依據（原文）', key: 'f', width: 70 },
    { header: '依據狀態', key: 'g', width: 22 },
  ];
  evidenceRows(run).forEach((r) => {
    const row = ev.addRow(Object.fromEntries(r.map((v, i) => [['a', 'b', 'c', 'd', 'e', 'f', 'g'][i], v])));
    row.alignment = { vertical: 'top', wrapText: true };
  });
  styleHeader(ev);

  const info = wb.addWorksheet('核查資訊');
  info.addRow(['第幾次核查', run.runNo]);
  info.addRow(['查詢詞', run.query]);
  info.addRow(['執行時間', new Date(run.createdAt).toLocaleString('zh-TW')]);
  info.addRow(['候選案件數', run.summary.total]);
  info.addRow(['納入', run.summary.include]);
  info.addRow(['排除', run.summary.exclude]);
  info.addRow(['需人工檢視', run.summary.review]);
  info.addRow(['無效依據（AI 依據找不到原文）', run.summary.invalidEvidenceCount]);
  info.addRow(['資料來源', '司法院裁判書查詢系統（公開資料）']);
  info.getColumn(1).width = 30;
  info.getColumn(2).width = 60;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
