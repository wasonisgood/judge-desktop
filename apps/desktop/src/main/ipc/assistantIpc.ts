// IPC：懸浮 AI 助理對話。查詢類工具直接執行；會花費額度的操作只會列為待確認（見 assistant.ts）。
import { ipcMain } from 'electron';
import { runAssistantTurn, type AssistantTurn } from '../assistant';
import { aiConfigOrThrow } from '../data/cloud/aiRepo';
import { executeAssistantTool } from '../services/assistantTools';

export function registerAssistantIpc(): void {
  ipcMain.handle('assistant:chat', async (_e, args: { history: { role: 'user' | 'assistant'; text: string }[]; text: string }) => {
    const turn: AssistantTurn = await runAssistantTurn(
      { config: aiConfigOrThrow, execute: executeAssistantTool },
      args.history.slice(-12),
      args.text,
    );
    return turn;
  });
}
