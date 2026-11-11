// IPC：任意格式檔案匯入。使用者選檔（Excel、CSV、TSV、TXT、Word、PDF 皆可），AI 判斷欄位，結果存入「檔案」（列表類）。
import * as path from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { importTableFile, IMPORT_EXTENSIONS } from '../services/tableImport';
import { saveToLibrary } from '../services/savedResult';
import { toUserError } from '../services/userError';

export function registerImportIpc(): void {
  ipcMain.handle('import:file', async (e, args: { ai?: string }) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts = { properties: ['openFile' as const], filters: [{ name: '判決清單（任何常見格式）', extensions: IMPORT_EXTENSIONS }] };
      const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
      const file = picked.filePaths[0];
      const ai = await requireAi(normalizeAiMode(args?.ai));
      const result = await importTableFile(file, ai);
      const name = path.basename(file);
      const saved = await saveToLibrary({
        kind: 'list',
        title: `匯入：${name}`,
        summary: `${result.items.length} 筆（匯入自 ${name}）`,
        payload: { keyword: '匯入', items: result.items, details: {} },
      });
      return {
        canceled: false,
        fileName: name,
        count: result.items.length,
        rowCount: result.rowCount,
        libraryId: saved.libraryId,
        saveError: saved.saveError,
        items: result.items,
      };
    } catch (err) {
      throw toUserError(err);
    }
  });
}
