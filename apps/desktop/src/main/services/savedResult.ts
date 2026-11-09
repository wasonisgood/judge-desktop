// 結果存檔（v3.6.0）：存入檔案管理失敗（磁碟滿、權限）時，結果仍要交給畫面，並回報存檔錯誤，不能讓已花費的 AI 額度白費。
import { library } from '../data/local/libraryAccess';

export interface SaveOutcome {
  /** null 表示已存入檔案管理；否則為中文說明。 */
  saveError: string | null;
}

export async function saveToLibrary(entry: Parameters<ReturnType<typeof library>['add']>[0]): Promise<SaveOutcome> {
  try {
    await library().add(entry);
    return { saveError: null };
  } catch (err) {
    return { saveError: `未能存入「檔案」（${err instanceof Error ? err.message : String(err)}），結果仍顯示於畫面，請及時匯出。` };
  }
}
