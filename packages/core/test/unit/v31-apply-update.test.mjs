// v31 單元測試（三）：模組更新的套用、校驗失敗、驗證失敗回滾與手動回滾（真的檔案 + 本機 HTTP）。
// 3.1 新增模組的單元測試：架構判讀、GitHub 摘要、規則表、診斷、版本沿用判斷、模組目錄與套用更新（真的檔案與本機 HTTP 伺服器）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  nativeArchFromWmi, ollamaAssetFor, archMatches,
  findVerifiedAsset, isSafeZipEntry,
  BUILTIN_RULES, validateRules, planLocalAI,
  runDiagnostics, summarize, formatDiagnosticReport,
  parseVersion, compareVersions, decideExistingEngine, modelsToPull,
  validateCatalog, planCatalogUpdate,
  applyModuleUpdate, readInstalledModule, rollbackModule, discardPrevious,
} from '../../dist/index.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const f = (content, url) => ({ sha256: sha(content), size: content.length, url });
// ---------- 套用更新（真的檔案 + 本機 HTTP） ----------
function serve(map) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const body = map[req.url];
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, hits, base });
  }));
}

async function tmpModule(files) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'judge-mod-'));
  const moduleDir = path.join(dir, 'current');
  await fsp.mkdir(moduleDir, { recursive: true });
  for (const [p, c] of Object.entries(files)) await fsp.writeFile(path.join(moduleDir, p), c);
  await fsp.writeFile(path.join(moduleDir, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));
  return moduleDir;
}

test('套用更新：只下載變動檔案，未變動檔案從本機複製（不發出網路請求）', async () => {
  const oldRules = Buffer.from('{"v":1}');
  const keep = Buffer.from('keep-content');
  const newRules = Buffer.from('{"v":2}');
  const { server, hits, base } = await serve({ '/rules.json': newRules, '/keep.json': keep });
  try {
    const moduleDir = await tmpModule({ 'rules.json': oldRules, 'keep.json': keep });
    const target = {
      version: '1.1.0', requiresAppUpdate: false,
      files: { 'rules.json': f(newRules, `${base}/rules.json`), 'keep.json': f(keep, `${base}/keep.json`) },
    };
    const r = await applyModuleUpdate({ moduleId: 'ai-engine', moduleDir, target });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.downloaded, ['rules.json']);
    assert.deepEqual(r.reused, ['keep.json']);
    assert.deepEqual(hits, ['/rules.json'], '未變動的檔案不應被下載');
    assert.equal((await fsp.readFile(path.join(moduleDir, 'rules.json'))).toString(), '{"v":2}');
    const inst = await readInstalledModule(moduleDir);
    assert.equal(inst.version, '1.1.0');
    assert.equal(fs.existsSync(`${moduleDir}.staging`), false);
    assert.equal(fs.existsSync(`${moduleDir}.previous`), true, '保留 previous 以便回滾');
  } finally {
    server.close();
  }
});

test('套用更新：校驗失敗 → 目前版本完全不變，暫存區清除', async () => {
  const { server, base } = await serve({ '/rules.json': Buffer.from('tampered') });
  try {
    const moduleDir = await tmpModule({ 'rules.json': Buffer.from('{"v":1}') });
    const target = { version: '1.1.0', requiresAppUpdate: false, files: { 'rules.json': f(Buffer.from('{"v":2}'), `${base}/rules.json`) } };
    const r = await applyModuleUpdate({ moduleId: 'ai-engine', moduleDir, target });
    assert.equal(r.ok, false);
    assert.match(r.error, /校驗失敗/);
    assert.equal(r.rolledBack, false);
    assert.equal((await fsp.readFile(path.join(moduleDir, 'rules.json'))).toString(), '{"v":1}');
    assert.equal(fs.existsSync(`${moduleDir}.staging`), false);
  } finally {
    server.close();
  }
});

test('套用更新：換入後驗證失敗 → 自動回滾到舊版本', async () => {
  const { server, base } = await serve({ '/rules.json': Buffer.from('{"bad":true}') });
  try {
    const moduleDir = await tmpModule({ 'rules.json': Buffer.from('{"v":1}') });
    const target = { version: '1.1.0', requiresAppUpdate: false, files: { 'rules.json': f(Buffer.from('{"bad":true}'), `${base}/rules.json`) } };
    const r = await applyModuleUpdate({
      moduleId: 'ai-engine', moduleDir, target,
      verify: async (dir) => {
        const j = JSON.parse(await fsp.readFile(path.join(dir, 'rules.json'), 'utf8'));
        return j.bad ? '規則表內容不合法' : null;
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.rolledBack, true);
    assert.match(r.error, /已回滾/);
    assert.equal((await fsp.readFile(path.join(moduleDir, 'rules.json'))).toString(), '{"v":1}', '回滾後應為舊版本');
    assert.equal((await readInstalledModule(moduleDir)).version, '1.0.0');
  } finally {
    server.close();
  }
});

test('套用更新：可手動回滾，discardPrevious 會清除備份', async () => {
  const { server, base } = await serve({ '/rules.json': Buffer.from('{"v":2}') });
  try {
    const moduleDir = await tmpModule({ 'rules.json': Buffer.from('{"v":1}') });
    const target = { version: '1.1.0', requiresAppUpdate: false, files: { 'rules.json': f(Buffer.from('{"v":2}'), `${base}/rules.json`) } };
    await applyModuleUpdate({ moduleId: 'ai-engine', moduleDir, target });
    assert.equal(await rollbackModule(moduleDir), true);
    assert.equal((await fsp.readFile(path.join(moduleDir, 'rules.json'))).toString(), '{"v":1}');
    // 再次更新後確認 discard
    await applyModuleUpdate({ moduleId: 'ai-engine', moduleDir, target });
    await discardPrevious(moduleDir);
    assert.equal(fs.existsSync(`${moduleDir}.previous`), false);
  } finally {
    server.close();
  }
});

