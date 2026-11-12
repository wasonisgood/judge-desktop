// 把 Ollama 引擎檔發佈到 Firebase Storage（judge-desktop/engine/）。與任何 GitHub Release 無關，只在引擎版本要更新時單獨執行。
// 用法：node scripts/publish-engine.mjs
// 流程：
//  1. 從 Ollama 官方 GitHub Release 取得最新版的 ARM64、x64 Windows zip 與其 SHA-256 摘要。
//  2. 下載後校驗 SHA-256；不符即中止，不上傳。
//  3. 上傳到 judge-desktop/engine/（應用程式會先從這裡下載，失敗才改用 Ollama 官方 GitHub）。
// 需要：gh（已登入）、gcloud（已登入，有 Storage 寫入權限）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const BUCKET = 'judge-remote-mcp-2026.firebasestorage.app';
// Windows 短路徑（路徑含空白時 .cmd 需要 shell，短路徑可避免引號問題）。可用環境變數 GCLOUD 覆寫。
const GCLOUD = process.env.GCLOUD || 'C:/Users/user/AppData/Local/Google/CLOUDS~1/GOOGLE~1/bin/gcloud.cmd';
const GH = process.env.GH || 'gh';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'));
const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: cmd.toLowerCase().endsWith('.cmd'), ...opts });
const cp = (localFile, objectPath) => {
  console.log(`上傳 ${objectPath}`);
  run(GCLOUD, ['storage', 'cp', localFile, `gs://${BUCKET}/${objectPath}`, '--project=judge-remote-mcp-2026']);
};

const ollamaRel = JSON.parse(execFileSync(GH, ['release', 'view', '--repo', 'ollama/ollama', '--json', 'tagName,assets'], { encoding: 'utf8' }));
for (const name of ['ollama-windows-arm64.zip', 'ollama-windows-amd64.zip']) {
  const asset = ollamaRel.assets.find((a) => a.name === name);
  if (!asset || !/^sha256:[0-9a-f]{64}$/.test(asset.digest || '')) throw new Error(`Ollama 資產 ${name} 沒有 SHA-256 摘要，拒絕上傳`);
  const expected = asset.digest.slice('sha256:'.length);
  const local = path.join(work, name);
  console.log(`下載 Ollama ${ollamaRel.tagName} ${name}（${asset.size} bytes）...`);
  run(GH, ['release', 'download', ollamaRel.tagName, '-R', 'ollama/ollama', '-p', name, '-D', work, '--clobber']);
  const actual = sha256(local);
  if (actual !== expected) throw new Error(`${name} 的 SHA-256 不符，拒絕上傳（預期 ${expected}，實際 ${actual}）`);
  cp(local, `judge-desktop/engine/${name}`);
}
console.log(`完成：Ollama ${ollamaRel.tagName} 引擎已發佈到 judge-desktop/engine/。暫存資料夾：${work}`);
