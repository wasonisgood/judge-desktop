// IPC：懸浮 AI 助理對話。查詢類工具直接執行；會花費額度的操作只會列為待確認（見 assistant.ts）。
// v3.6.0：每次對話登記為背景工作，可取消；錯誤以中文說明回給畫面。
import { ipcMain } from 'electron';
import { runAssistantTurn, type AssistantTurn } from '../assistant';
import { aiConfigOrThrow } from '../data/cloud/aiRepo';
import { executeAssistantTool } from '../services/assistantTools';
import { withJob } from '../services/jobRegistry';
import { toUserError } from '../services/userError';

export function registerAssistantIpc(): void {
  // context：畫面送來的目前頁面與控制項目錄（主程序會再次清理與驗證，見 assistantUi.ts）。
  ipcMain.handle('assistant:chat', (_e, args: { runId: string; history: { role: 'user' | 'assistant'; text: string }[]; text: string; searchMode?: 'ai' | 'traditional'; context?: { page?: string; controls?: unknown } }) =>
    withJob(args.runId, 'assistant', '助理對話', async (signal): Promise<AssistantTurn> => {
      try {
        return await runAssistantTurn(
          { config: aiConfigOrThrow, execute: executeAssistantTool },
          args.history.slice(-12),
          args.text,
          { searchMode: args.searchMode, signal, page: args.context?.page, controls: args.context?.controls },
        );
      } catch (err) {
        throw toUserError(err);
      }
    }));
}
