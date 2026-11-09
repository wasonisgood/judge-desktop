// 發版時產生模組目錄 modules.json，並把每個模組檔案複製成 release 資產（名稱：module-<模組>-<路徑用-連接>）。
// 用法：node scripts/make-catalog.mjs <tag> <輸出資料夾>
// 目錄內每個檔案都有 sha256、大小與下載網址；桌面端只下載與本機不同的檔案。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulesRoot = path.join(here, '..', 'modules');
const [tag, outDir] = process.argv.slice(2);
if (!tag || !outDir) {
  console.error('用法：node scripts/make-catalog.mjs <tag> <輸出資料夾>');
  process.exit(1);
}
// 與 @judge/core 的 FIREBASE_BUCKET 相同（Firebase Storage 鏡像）。
const FIREBASE_BUCKET = 'judge-remote-mcp-2026.firebasestorage.app';
const repo = process.env.GITHUB_REPOSITORY || 'wasonisgood/judge-desktop';
fs.mkdirSync(outDir, { recursive: true });

const catalog = { catalogVersion: 1, modules: {} };
for (const id of fs.readdirSync(modulesRoot)) {
  const dir = path.join(modulesRoot, id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
  const files = {};
  const walk = (d, base = d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, base);
      else if (e.name !== 'module.json') {
        const rel = path.relative(base, full).split(path.sep).join('/');
        const buf = fs.readFileSync(full);
        const asset = `module-${id}-${rel.replace(/\//g, '-')}`;
        fs.copyFileSync(full, path.join(outDir, asset));
        files[rel] = {
          sha256: createHash('sha256').update(buf).digest('hex'),
          size: buf.length,
          url: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
          mirror: `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/${encodeURIComponent(`judge-desktop/${tag}/${asset}`)}?alt=media`,
        };
      }
    }
  };
  walk(dir);
  catalog.modules[id] = { version: meta.version, requiresAppUpdate: !!meta.requiresAppUpdate, files };
}
fs.writeFileSync(path.join(outDir, 'modules.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(`目錄已產生：${path.join(outDir, 'modules.json')}（模組 ${Object.keys(catalog.modules).join(', ')}）`);
