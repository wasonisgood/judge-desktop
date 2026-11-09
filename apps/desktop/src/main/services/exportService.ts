// 匯出服務：所有匯出一律自動存到「文件／司法院裁判研究」資料夾，跑完後自動開啟，不再跳出存檔對話框。
import { app, shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 匯出目錄（文件／司法院裁判研究）。 */
export function exportDir(...sub: string[]): string {
  return path.join(app.getPath('documents'), '司法院裁判研究', ...sub);
}

export async function autoSaveExport(name: string, data: Buffer): Promise<{ canceled: false; filePath: string }> {
  const dir = exportDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name.replace(/[\/:*?"<>|]/g, '_'));
  await fs.writeFile(file, data);
  void shell.openPath(file);
  return { canceled: false, filePath: file };
}
