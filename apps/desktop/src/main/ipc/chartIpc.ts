// IPC：量化圖表模組（issue #8）。模組安裝／停用／移除、讀取 Excel、組圖、匯出 SVG／PNG／Word。
// 模組狀態以模組登錄（chart）為準；非 ready 時一律拒絕，主程式其餘功能不受影響。
import * as path from 'node:path';
import { dialog, ipcMain } from 'electron';
import { isModuleReady } from '@judge/core';
import { readModuleStatus } from '../data/local/registryStore';
import { getMainWindow } from '../windows/windowState';
import { autoSaveExport } from '../services/exportService';
import { toUserError } from '../services/userError';
import { installChartModuleForApp, disableChartModule, removeChartModule } from '../services/chartModule';
import { buildChartResult, inspectChartWorkbook, loadChartSheet, sanitizeChartConfig } from '../services/chartData';
import { buildChartDocx, pngSize, sanitizeTable } from '../chartExporters';

const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

async function requireChartModule(): Promise<void> {
  const st = (await readModuleStatus()).chart;
  if (!isModuleReady(st)) throw new Error('量化圖表模組尚未安裝、已停用或已移除；請到「設定」的模組區安裝並啟用。');
}

function checkXlsxPath(p: unknown): string {
  if (typeof p !== 'string' || !p) throw new Error('請先選擇 Excel 檔案');
  if (path.extname(p).toLowerCase() !== '.xlsx') throw new Error('目前只支援 .xlsx 檔案');
  return p;
}

function safeName(name: string): string {
  return (name || '量化圖表').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

export function registerChartIpc(): void {
  ipcMain.handle('chart:install', async () => {
    try {
      return await installChartModuleForApp();
    } catch (err) {
      throw toUserError(err);
    }
  });

  ipcMain.handle('chart:disable', () => disableChartModule());

  ipcMain.handle('chart:remove', () => removeChartModule());

  ipcMain.handle('chart:pickFile', async () => {
    await requireChartModule();
    const win = getMainWindow();
    const opts = {
      title: '選擇 Excel 結果檔',
      properties: ['openFile' as const],
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return { canceled: true as const };
    return { canceled: false as const, filePath: res.filePaths[0], fileName: path.basename(res.filePaths[0]) };
  });

  ipcMain.handle('chart:inspect', async (_e, args: { filePath: string }) => {
    await requireChartModule();
    try {
      return await inspectChartWorkbook(checkXlsxPath(args?.filePath));
    } catch (err) {
      throw toUserError(err);
    }
  });

  ipcMain.handle('chart:render', async (_e, args: { filePath: string; sheet: string; config: unknown }) => {
    await requireChartModule();
    try {
      const { fileName, sheet, inferredKinds } = await loadChartSheet(checkXlsxPath(args?.filePath), String(args?.sheet ?? ''));
      return buildChartResult({ sheet, fileName, inferredKinds, config: sanitizeChartConfig(args?.config) });
    } catch (err) {
      throw toUserError(err);
    }
  });

  ipcMain.handle('export:chartSvg', async (_e, args: { name: string; svg: string }) => {
    await requireChartModule();
    if (typeof args?.svg !== 'string' || !args.svg.startsWith('<svg')) throw new Error('沒有可匯出的圖表');
    return autoSaveExport(`${safeName(args.name)}.svg`, Buffer.from(args.svg, 'utf8'));
  });

  ipcMain.handle('export:chartPng', async (_e, args: { name: string; base64: string }) => {
    await requireChartModule();
    if (typeof args?.base64 !== 'string' || !args.base64) throw new Error('沒有可匯出的圖表');
    const buf = Buffer.from(args.base64, 'base64');
    if (buf.length === 0 || buf.length > MAX_EXPORT_BYTES) throw new Error('圖表影像大小不合理，未匯出');
    if (buf.subarray(0, 4).toString('hex') !== '89504e47') throw new Error('不是 PNG 影像，未匯出');
    return autoSaveExport(`${safeName(args.name)}.png`, buf);
  });

  ipcMain.handle('export:chartDocx', async (_e, args: { name: string; title: string; note: string; unitLabel: string; png?: string | null; table?: unknown }) => {
    await requireChartModule();
    try {
      const table = sanitizeTable(args?.table);
      const png = typeof args?.png === 'string' && args.png ? Buffer.from(args.png, 'base64') : null;
      if (png) {
        if (png.length > MAX_EXPORT_BYTES) throw new Error('圖表影像大小不合理，未匯出');
        pngSize(png); // 不是 PNG 時拋錯
      }
      if (!png && !table) throw new Error('沒有可匯出的圖表');
      const buf = await buildChartDocx({
        title: String(args?.title ?? '').slice(0, 200),
        note: String(args?.note ?? '').slice(0, 2000),
        unitLabel: String(args?.unitLabel ?? '').slice(0, 200),
        png,
        table,
      });
      return await autoSaveExport(`${safeName(args?.name)}.docx`, buf);
    } catch (err) {
      throw toUserError(err);
    }
  });
}
