// 發佈爭點知識庫模組到 Firebase 靜態儲存庫（與法規鏡像、安裝檔同一個 bucket，安裝檔不包含內容）。
// 用法：node knowledge/tools/publish-knowledge.mjs <版本，例如 1.0.0> [--dry-run] [--data <目錄>]
// 流程：
//  1. 用核心的結構驗證檢查每個 JSON（任何驗證錯誤都中止發佈）。
//  2. 計算每個檔案的 SHA-256，產生清單 manifest。
//  3. 上傳到 gs://<bucket>/judge-desktop/knowledge/v<版本>/ 並更新 judge-desktop/knowledge/latest.json。
// 應用程式只會下載清單中列出的檔案，並逐檔比對 SHA-256（見 knowledgeService.installKnowledgeModule）。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as core from '../../packages/core/dist/index.js';

const BUCKET = 'judge-remote-mcp-2026.firebasestorage.app';
const PROJECT = 'judge-remote-mcp-2026';
const GCLOUD = 'C:/Users/user/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd';

const args = process.argv.slice(2);
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const dryRun = args.includes('--dry-run');
const dataIdx = args.indexOf('--data');
const dataDir = path.resolve(dataIdx >= 0 ? args[dataIdx + 1] : path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', 'data'));
if (!version) {
  console.error('用法：node publish-knowledge.mjs <版本，例如 1.0.0> [--dry-run] [--data <目錄>]');
  process.exit(2);
}

// 1. 結構驗證（任何錯誤都中止；重複 id 也視為錯誤）
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error(`找不到 JSON 檔：${dataDir}`);
  process.exit(1);
}
const sources = files.map((f) => ({ source: f, raw: JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')) }));
const built = core.buildKnowledgeIndex(sources);
if (built.problems.length > 0) {
  console.error(`驗證失敗，共 ${built.problems.length} 項，已中止發佈：`);
  for (const p of built.problems.slice(0, 30)) console.error(`  ${p.source} ${p.issueId ?? ''} ${p.message}`);
  process.exit(1);
}

// 2. 清單
const prefix = `judge-desktop/knowledge/v${version}`;
const manifest = {
  version,
  issueCount: built.index.issues.length,
  files: files.map((name) => {
    const buf = fs.readFileSync(path.join(dataDir, name));
    return {
      name,
      sha256: createHash('sha256').update(buf).digest('hex'),
      size: buf.length,
      object: `${prefix}/${name}`,
    };
  }),
};
const outDir = path.join(path.dirname(dataDir), 'dist', `knowledge-v${version}`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`驗證通過：${manifest.issueCount} 個爭點，${files.length} 個檔案，版本 ${version}`);

if (dryRun) {
  console.log('--dry-run：未上傳。清單已寫入', path.join(outDir, 'manifest.json'));
  process.exit(0);
}

// 3. 上傳（版本目錄 + latest.json）
const gs = (obj) => `gs://${BUCKET}/${obj}`;
for (const f of manifest.files) {
  execFileSync(GCLOUD, ['storage', 'cp', path.join(dataDir, f.name), gs(f.object), `--project=${PROJECT}`], { stdio: 'inherit' });
}
const latestLocal = path.join(outDir, 'latest.json');
fs.writeFileSync(latestLocal, JSON.stringify(manifest, null, 2), 'utf8');
execFileSync(GCLOUD, ['storage', 'cp', latestLocal, gs('judge-desktop/knowledge/latest.json'), `--project=${PROJECT}`], { stdio: 'inherit' });
console.log(`已上傳 ${manifest.files.length} 個檔案與 latest.json 到 ${prefix}/`);
