// IPC：登入（狀態、開始、取消、登出）。登入流程與權杖保存都在主程序，畫面只拿到狀態。
import { ipcMain } from 'electron';
import { authStatus, startLogin, cancelLogin, signOut } from '../services/authService';

export function registerAuthIpc(): void {
  ipcMain.handle('auth:status', () => authStatus());
  ipcMain.handle('auth:start', () => startLogin());
  ipcMain.handle('auth:cancel', () => cancelLogin());
  ipcMain.handle('auth:signOut', () => signOut());
}
