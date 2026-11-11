// 執行單元測試（不含需要網路或真實 AI 的 live 測試）。發版工作流程會在建置後執行，失敗即中止發版。
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'test'))
  .filter((f) => f.endsWith('.test.mjs') && !f.includes('live'))
  .sort()
  .map((f) => join('test', f));

const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) {
  console.error(`\n測試失敗（${files.length} 個測試檔）。修正後才能發版。`);
}
process.exit(result.status ?? 1);
