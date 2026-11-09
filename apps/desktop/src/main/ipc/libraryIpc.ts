// IPC：檔案管理（列表、更新狀態／星號、永久刪除）與懸浮 AI 助理。
import { ipcMain } from 'electron';
import type { LibraryStatus } from '../library';
import { library } from '../data/local/libraryAccess';

export function registerLibraryIpc(): void {
  ipcMain.handle('library:list', async (_e, args: { status?: LibraryStatus }) => library().list(args?.status));
  ipcMain.handle('library:update', async (_e, args: { id: string; patch: { status?: LibraryStatus; starred?: boolean } }) => {
    await library().update(args.id, args.patch);
    return { ok: true };
  });
  ipcMain.handle('library:remove', async (_e, args: { id: string }) => {
    return { removed: await library().removePermanently(args.id) };
  });
}
