// 更新程式服務：應用程式啟動時在背景執行安裝資料夾內的 JudgeResearchUpdater.exe；並讀取其狀態（唯讀）。
import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { isDev } from '../data/local/paths';

export interface UpdaterStatus {
  phase: string; lastCheckUtc: string | null; lastCheckResult: string | null; latestVersion: string | null; lastError: string | null; running: boolean; available: boolean;
}

export function updaterPath(): string {
  return path.join(path.dirname(app.getPath('exe')), 'JudgeResearchUpdater.exe');
}

/** 讀取更新程式寫入的 update-state.json，並查詢程序是否正在執行（唯讀）。 */
export async function readUpdaterStatus(): Promise<UpdaterStatus> {
  const file = path.join(app.getPath('appData'), 'JudgeResearch', 'update-state.json');
  let s: Record<string, string> = {};
  try { s = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* 尚未產生 */ }
  let running = false;
  if (process.platform === 'win32') {
    running = await new Promise<boolean>((resolve) => {
      const child = spawn('tasklist.exe', ['/FI', 'IMAGENAME eq JudgeResearchUpdater.exe', '/NH'], { windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.on('error', () => resolve(false));
      child.on('close', () => resolve(/JudgeResearchUpdater\.exe/i.test(out)));
    });
  }
  const updaterExists = fsSync.existsSync(updaterPath());
  return {
    phase: s.phase ?? 'idle',
    lastCheckUtc: s.lastCheckUtc ?? null,
    lastCheckResult: s.lastCheckResult ?? null,
    latestVersion: s.latestVersion ?? null,
    lastError: s.lastError ?? null,
    running,
    available: updaterExists,
  };
}

export function openUpdater(manual: boolean): boolean {
  const exe = updaterPath();
  if (isDev || !fsSync.existsSync(exe)) return false;
  const args = ['--app-version', app.getVersion()];
  if (manual) args.push('--manual');
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
  return true;
}
