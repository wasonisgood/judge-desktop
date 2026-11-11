import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const scriptDir = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname));
const rootDir = path.resolve(scriptDir, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
const releaseConfig = JSON.parse(fs.readFileSync(path.join(scriptDir, 'release.json'), 'utf-8'));

const publishDir = path.join(scriptDir, 'publish');
if (!fs.existsSync(publishDir)) {
  fs.mkdirSync(publishDir, { recursive: true });
}

// 優先定位由 build_installer.ps1 編譯出之 C# WPF 原生客製化安裝精靈
const rootInstaller = path.join(rootDir, releaseConfig.installerFileName);
const scriptInstaller = path.join(scriptDir, releaseConfig.installerFileName);
const publishInstaller = path.join(publishDir, releaseConfig.installerFileName);

let foundExe = null;
if (fs.existsSync(rootInstaller)) {
  foundExe = rootInstaller;
} else if (fs.existsSync(scriptInstaller)) {
  foundExe = scriptInstaller;
} else if (fs.existsSync(publishInstaller)) {
  foundExe = publishInstaller;
}

let fileSize = 0;
let sha256 = '';

if (foundExe) {
  const buf = fs.readFileSync(foundExe);
  if (buf.includes(Buffer.from('Nullsoft'))) {
    throw new Error(`CRITICAL: Found installer ${foundExe} contains Nullsoft NSIS signature! Expected genuine WPF installer.`);
  }
  fileSize = buf.length;
  sha256 = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();

  // 確保根目錄、installer 目錄與 publish 目錄之安裝精靈一致
  if (foundExe !== rootInstaller) {
    fs.copyFileSync(foundExe, rootInstaller);
  }
  if (foundExe !== scriptInstaller) {
    fs.copyFileSync(foundExe, scriptInstaller);
  }
  if (foundExe !== publishInstaller) {
    fs.copyFileSync(foundExe, publishInstaller);
  }
  console.log(`Verified custom installer: ${foundExe} (${fileSize} bytes, SHA256: ${sha256})`);
} else {
  console.warn(`Installer ${releaseConfig.installerFileName} not found in root or installer directory.`);
}

// App payload（只含 App 本體的 zip）：一般更新只下載它，不必重下安裝程式。
// 與安裝程式內嵌的 app-payload.zip 為同一份檔案；發佈時以版本命名，避免與其他版本混淆。
const payloadName = `JudgeResearchPayload-${pkg.version}.zip`;
const payloadSrc = path.join(scriptDir, 'app-payload.zip');
let payloadSize = 0;
let payloadSha256 = '';
let payloadUrl = '';
if (fs.existsSync(payloadSrc)) {
  const pbuf = fs.readFileSync(payloadSrc);
  payloadSize = pbuf.length;
  payloadSha256 = crypto.createHash('sha256').update(pbuf).digest('hex').toLowerCase();
  fs.copyFileSync(payloadSrc, path.join(publishDir, payloadName));
  payloadUrl = `https://github.com/${releaseConfig.githubRepo}/releases/download/v${pkg.version}/${payloadName}`;
  console.log(`Payload ${payloadName} (${payloadSize} bytes, SHA256: ${payloadSha256})`);
} else {
  console.warn('app-payload.zip not found; manifest will not offer payload-only updates.');
}

const manifest = {
  version: pkg.version,
  installerVersion: releaseConfig.installerVersion || '',
  minimumVersion: releaseConfig.minimumVersion,
  mandatory: Boolean(releaseConfig.mandatory),
  releaseDate: new Date().toISOString().split('T')[0],
  installerUrl: `https://github.com/${releaseConfig.githubRepo}/releases/download/v${pkg.version}/${releaseConfig.installerFileName}`,
  installerMirrorUrl: `https://firebasestorage.googleapis.com/v0/b/judge-remote-mcp-2026.firebasestorage.app/o/${encodeURIComponent(`judge-desktop/v${pkg.version}/${releaseConfig.installerFileName}`)}?alt=media`,
  size: fileSize,
  sha256: sha256,
  payloadUrl: payloadSha256 ? payloadUrl : '',
  // 鏡像（Firebase Storage）優先，與安裝程式相同；publish-mirror.mjs 會上傳到同一路徑。
  payloadMirrorUrl: payloadSha256 ? `https://firebasestorage.googleapis.com/v0/b/judge-remote-mcp-2026.firebasestorage.app/o/${encodeURIComponent(`judge-desktop/v${pkg.version}/${payloadName}`)}?alt=media` : '',
  payloadSize: payloadSize,
  payloadSha256: payloadSha256,
  notes: releaseConfig.notes
};

fs.writeFileSync(path.join(publishDir, 'latest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
console.log(`Successfully generated latest.json for version ${pkg.version}`);
