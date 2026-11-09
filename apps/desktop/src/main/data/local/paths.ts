// 本地資料層：路徑與執行環境。所有寫入使用者電腦的資料都從這裡取得路徑。
import { app } from 'electron';
import * as path from 'node:path';

export const isDev = !app.isPackaged;

/** 使用者資料夾（userData）底下的路徑。 */
export const userPath = (...p: string[]) => path.join(app.getPath('userData'), ...p);
