// 本地資料層：本地模組的常數與路徑。
// 內建模組位置以編譯後的檔案為準（dist/main/data/local → 應用程式根目錄的 modules）。不可用 app.getAppPath()：
// 在 electron 以腳本啟動時它會指向腳本所在資料夾。打包後 modules/** 也會一起進入應用程式。
import { app } from 'electron';
import * as path from 'node:path';
import { OLLAMA_DEFAULT_URL, type ModuleId } from '@judge/core';

export const AI_ENGINE_MODULE_ID: ModuleId = 'ai-engine';
export const MODULE_IDS: ModuleId[] = ['ai-engine', 'crawler'];
/** 使用者既有的 Ollama 服務。 */
export const EXTERNAL_BASE = OLLAMA_DEFAULT_URL;
/** 本程式自己的服務，避免與既有服務衝突。 */
export const OWN_PORT = 11435;
export const OWN_BASE = `http://127.0.0.1:${OWN_PORT}`;

export const userData = () => app.getPath('userData');
export const modulesRoot = () => path.join(userData(), 'modules');
export const moduleCurrent = (id: ModuleId) => path.join(modulesRoot(), id, 'current');
export const engineRoot = () => path.join(userData(), 'engine');
/** 編譯後位於 dist/main/data/local，往上四層即應用程式根目錄。 */
export const bundledModuleDir = (id: ModuleId) => path.join(__dirname, '..', '..', '..', '..', 'modules', id);
