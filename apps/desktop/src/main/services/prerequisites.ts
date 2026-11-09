// 前置工具檢查（macOS、Linux）：安裝引擎前確認 tar 與 df 可用。缺少時回傳可顯示給使用者的修復步驟。
// 只執行唯讀的 command -v 與 tar --version，不安裝任何東西。
import * as fs from 'node:fs/promises';
import {
  REQUIRED_TOOLS, isTarVersionOutput, distroIdFromOsRelease, prerequisiteSteps, type RequiredTool,
} from '@judge/core';
import { runCommand } from '../data/local/system';

async function hasTool(tool: RequiredTool): Promise<boolean> {
  try {
    await runCommand('sh', ['-c', `command -v ${tool}`]);
  } catch {
    return false;
  }
  if (tool !== 'tar') return true;
  try {
    return isTarVersionOutput(await runCommand('tar', ['--version']));
  } catch {
    return false;
  }
}

async function distroId(): Promise<string | null> {
  try {
    return distroIdFromOsRelease(await fs.readFile('/etc/os-release', 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 回傳 { ok: true }，或 { ok: false, error }。error 的格式為「技術訊息｜使用者步驟」，
 * 並以「缺少系統工具」開頭，讓錯誤分類歸為 PREREQUISITE_MISSING。
 */
export async function checkPrerequisites(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.platform === 'win32') return { ok: true };
  const missing: RequiredTool[] = [];
  for (const tool of REQUIRED_TOOLS) {
    if (!(await hasTool(tool))) missing.push(tool);
  }
  if (missing.length === 0) return { ok: true };
  const steps = prerequisiteSteps(missing, await distroId());
  const tech = `缺少系統工具：${missing.join('、')}。`;
  return { ok: false, error: `${tech}${steps.slice(1).join('，')}` };
}
