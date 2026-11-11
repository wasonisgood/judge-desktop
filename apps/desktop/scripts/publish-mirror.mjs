// 把發版檔案發佈到 Firebase Storage 鏡像（judge-desktop/…）。
// 用法：node scripts/publish-mirror.mjs <tag>            （例如 v3.1.0）
// 流程：
//  1. 從 GitHub Release 下載該版的安裝程式、latest.json、模組檔案。
//  2. 重新產生模組目錄 modules.json（每個檔案帶 Storage 鏡像網址）。
//  3. latest.json 補上 installerMirrorUrl；modules.json 與 latest.json 複製到 judge-desktop/latest/。
//  4. 下載 Ollama 官方 zip（ARM64、x64），確認 SHA-256 與 GitHub 摘要相符後才上傳到 judge-desktop/engine/。
// 需要：gh（已登入）、gcloud（已登入，有 Storage 寫入權限）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = 'judge-remote-mcp-2026.firebasestorage.app';
const REPO = 'wasonisgood/judge-desktop';
// Windows 短路徑（路徑含空白時 .cmd 需要 shell，短路徑可避免引號問題）。可用環境變數 GCLOUD 覆寫。
const GCLOUD = process.env.GCLOUD || 'C:/Users/user/AppData/Local/Google/CLOUDS~1/GOOGLE~1/bin/gcloud.cmd';
const GH = process.env.GH || 'gh';
const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('用法：node scripts/publish-mirror.mjs v<版本>');
  process.exit(1);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), `mirror-${tag}-`));
const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
// .cmd 檔需透過 shell 執行（Windows 上 Node 無法直接啟動 .cmd）。
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: cmd.toLowerCase().endsWith('.cmd'), ...opts });
const cp = (localFile, objectPath) => {
  console.log(`上傳 ${objectPath}`);
  run(GCLOUD, ['storage', 'cp', localFile, `gs://${BUCKET}/${objectPath}`, '--project=judge-remote-mcp-2026']);
};
const mirrorUrl = (obj) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(obj)}?alt=media`;

// 1. 下載 GitHub Release 資產
const dl = path.join(work, 'release');
fs.mkdirSync(dl);
console.log(`下載 GitHub Release ${tag} ...`);
run(GH, ['release', 'download', tag, '-R', REPO, '-D', dl, '--clobber']);

// 2. 模組目錄（每個檔案帶鏡像網址）
const modDir = path.join(work, 'modules-out');
fs.mkdirSync(modDir);
run('node', [path.join(here, 'make-catalog.mjs'), tag, modDir]);
// 模組檔案本身：release 裡的 module-* 與 modules.json 之後一併上傳到 judge-desktop/<tag>/
for (const f of fs.readdirSync(modDir)) {
  if (f === 'modules.json') continue;
  cp(path.join(modDir, f), `judge-desktop/${tag}/${f}`);
}

// 3. 安裝程式與 latest.json（補上鏡像網址）
const installer = 'JudgeResearchSetup.exe';
const latestSrc = path.join(dl, 'latest.json');
const latest = JSON.parse(fs.readFileSync(latestSrc, 'utf8'));
latest.installerMirrorUrl = mirrorUrl(`judge-desktop/${tag}/${installer}`);
// App payload（只更新 App 時下載）：有才上傳並補上鏡像網址；沒有時更新程式會改用 GitHub 或完整安裝程式。
const payloadName = `JudgeResearchPayload-${latest.version}.zip`;
const payloadLocal = path.join(dl, payloadName);
if (fs.existsSync(payloadLocal) && latest.payloadSha256) {
  if (sha256(payloadLocal) !== latest.payloadSha256) throw new Error(`${payloadName} 的 SHA-256 與 latest.json 不符，拒絕發佈`);
  latest.payloadMirrorUrl = mirrorUrl(`judge-desktop/${tag}/${payloadName}`);
  cp(payloadLocal, `judge-desktop/${tag}/${payloadName}`);
} else {
  console.warn(`找不到 ${payloadName}，只更新 App 的鏡像網址留空。`);
}
const latestOut = path.join(work, 'latest.json');
fs.writeFileSync(latestOut, JSON.stringify(latest, null, 2));
cp(path.join(dl, installer), `judge-desktop/${tag}/${installer}`);
cp(latestOut, `judge-desktop/${tag}/latest.json`);
// 固定位置（給自動更新讀取）
cp(latestOut, 'judge-desktop/latest/latest.json');
cp(path.join(modDir, 'modules.json'), 'judge-desktop/latest/modules.json');
cp(path.join(dl, installer), `judge-desktop/latest/${installer}`);

// 4. Ollama 官方 zip（先以 GitHub 摘要校驗，再上傳）
const ollamaRel = JSON.parse(execFileSync(GH, ['release', 'view', '--repo', 'ollama/ollama', '--json', 'tagName,assets'], { encoding: 'utf8' }));
for (const name of ['ollama-windows-arm64.zip', 'ollama-windows-amd64.zip']) {
  const asset = ollamaRel.assets.find((a) => a.name === name);
  if (!asset || !/^sha256:[0-9a-f]{64}$/.test(asset.digest || '')) throw new Error(`Ollama 資產 ${name} 沒有 SHA-256 摘要，拒絕上傳`);
  const expected = asset.digest.slice('sha256:'.length);
  const local = path.join(work, name);
  console.log(`下載 Ollama ${name}（${asset.size} bytes）...`);
  run(GH, ['release', 'download', ollamaRel.tagName, '-R', 'ollama/ollama', '-p', name, '-D', work, '--clobber']);
  const actual = sha256(local);
  if (actual !== expected) throw new Error(`${name} 的 SHA-256 不符，拒絕上傳（預期 ${expected}，實際 ${actual}）`);
  cp(local, `judge-desktop/engine/${name}`);
}
console.log(`完成：${tag} 已發佈到 Firebase Storage（judge-desktop/…）。暫存資料夾：${work}`);
