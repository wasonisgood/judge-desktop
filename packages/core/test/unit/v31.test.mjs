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

// ---------- 架構 ----------
test('nativeArchFromWmi：12=ARM64、9=x64、0=x86、5=ARM32，其他為 unknown', () => {
  assert.equal(nativeArchFromWmi(12), 'arm64');
  assert.equal(nativeArchFromWmi('9'), 'x64');
  assert.equal(nativeArchFromWmi(0), 'x86');
  assert.equal(nativeArchFromWmi(5), 'arm32');
  assert.equal(nativeArchFromWmi(null), 'unknown');
});

test('ollamaAssetFor：arm64 用 arm64 zip，x64 用 amd64 zip，其餘不支援', () => {
  assert.equal(ollamaAssetFor('arm64'), 'ollama-windows-arm64.zip');
  assert.equal(ollamaAssetFor('x64'), 'ollama-windows-amd64.zip');
  assert.equal(ollamaAssetFor('x86'), null);
});

test('archMatches：架構相符 true、不符 false、未知 null', () => {
  assert.equal(archMatches('arm64', 'arm64'), true);
  assert.equal(archMatches('x64', 'arm64'), false, 'x64 引擎跑在 ARM64 上是模擬執行');
  assert.equal(archMatches(null, 'arm64'), null);
  assert.equal(archMatches('arm64', 'unknown'), null);
});

// ---------- GitHub 資產與摘要 ----------
test('findVerifiedAsset：有 sha256 摘要才回傳；沒有摘要一律拒絕', () => {
  const assets = [
    { name: 'a.zip', size: 10, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://x/a.zip' },
    { name: 'b.zip', size: 10, digest: null },
  ];
  const a = findVerifiedAsset(assets, 'a.zip');
  assert.equal(a.sha256, 'a'.repeat(64));
  assert.equal(a.url, 'https://x/a.zip');
  assert.equal(findVerifiedAsset(assets, 'b.zip'), null, '無摘要不可用');
  assert.equal(findVerifiedAsset(assets, 'none.zip'), null);
});

test('isSafeZipEntry：拒絕跳出目錄的路徑（zip-slip）', () => {
  assert.equal(isSafeZipEntry('lib/ollama/x.dll'), true);
  assert.equal(isSafeZipEntry('../evil.exe'), false);
  assert.equal(isSafeZipEntry('a/../../evil.exe'), false);
  assert.equal(isSafeZipEntry('/abs/evil.exe'), false);
  assert.equal(isSafeZipEntry('C:\\evil.exe'), false);
});

// ---------- 規則表 ----------
test('validateRules：內建規則有效；缺模型名稱、門檻順序錯誤、版本不對都拒絕', () => {
  assert.equal(validateRules(BUILTIN_RULES).ok, true);
  const noModel = structuredClone(BUILTIN_RULES);
  noModel.tiers.light.judgment = '';
  assert.equal(validateRules(noModel).ok, false);
  const badOrder = structuredClone(BUILTIN_RULES);
  badOrder.tiers.heavy.minRamGB = 4;
  assert.match(validateRules(badOrder).error, /門檻/);
  assert.equal(validateRules({ ...BUILTIN_RULES, schemaVersion: 2 }).ok, false);
  assert.equal(validateRules({ ...BUILTIN_RULES, minEngineVersion: 'abc' }).ok, false);
});

test('planLocalAI：可接受模組規則表（門檻改變會影響分級）', () => {
  const rules = structuredClone(BUILTIN_RULES);
  rules.tiers.light.minRamGB = 4; // 模組更新後，4 GB 也能跑輕量
  const hw = { ramGB: 6, freeDiskGB: 50, vramGB: 0, gpuVendor: 'none' };
  assert.equal(planLocalAI(hw).tier, 'none');
  assert.equal(planLocalAI(hw, rules).tier, 'light');
});

// ---------- 既有服務沿用判斷 ----------
test('parseVersion / compareVersions：版本比較', () => {
  assert.deepEqual(parseVersion('v0.40.15'), [0, 40, 15]);
  assert.equal(compareVersions('0.39.2', '0.40.0'), -1);
  assert.equal(compareVersions('0.40.0', '0.40.0'), 0);
  assert.equal(compareVersions('0.41.0', '0.40.0'), 1);
  assert.equal(compareVersions('garbage', '0.40.0'), null);
});

test('decideExistingEngine：沒有服務 → 自行安裝；舊版 → 不沿用、自行安裝新版；新版 → 沿用', () => {
  assert.equal(decideExistingEngine(null, '0.40.0').action, 'none');
  const old = decideExistingEngine('0.12.0', '0.40.0');
  assert.equal(old.action, 'install-own');
  assert.match(old.reason, /原服務不受影響/);
  assert.equal(decideExistingEngine('0.40.15', '0.40.0').action, 'adopt');
  assert.equal(decideExistingEngine('weird', '0.40.0').action, 'install-own');
});

test('modelsToPull：已安裝的所需模型不重下；其他已安裝模型保留（不在清單中）', () => {
  assert.deepEqual(modelsToPull(['qwen2.5:3b'], ['qwen2.5:3b', 'llama3:8b']), []);
  assert.deepEqual(modelsToPull(['qwen2.5:3b', 'qwen2.5:7b'], ['qwen2.5:7b']), ['qwen2.5:3b']);
  assert.deepEqual(modelsToPull(['qwen2.5:3b'], []), ['qwen2.5:3b']);
});

// ---------- 診斷 ----------
const healthy = {
  nativeArch: 'arm64', engineArch: 'arm64', engineFileOk: true, engineSignature: 'Valid',
  serviceVersion: '0.40.15', requiredModels: ['qwen2.5:3b'], installedModels: ['qwen2.5:3b'],
  chatSmokeOk: true, freeDiskGB: 50, requiredDiskGB: 3, network: { general: true, judicial: true },
  moduleStatus: 'ready', recentFailure: null, hasPlan: true,
};
const byId = (checks, id) => checks.find((c) => c.id === id);

test('診斷：全部正常 → 總結 pass', () => {
  const s = summarize(runDiagnostics(healthy));
  assert.equal(s.overall, 'pass', JSON.stringify(s.checks.filter((c) => c.status !== 'pass')));
});

test('診斷：服務沒回應 → 失敗並建議重新啟動服務', () => {
  const c = runDiagnostics({ ...healthy, serviceVersion: null });
  assert.equal(byId(c, 'service').status, 'fail');
  assert.equal(byId(c, 'service').fix, 'restart-service');
});

test('診斷：缺模型 → 失敗並建議重新下載模型，且指出缺哪一個', () => {
  const c = runDiagnostics({ ...healthy, installedModels: [] });
  assert.equal(byId(c, 'models').status, 'fail');
  assert.equal(byId(c, 'models').fix, 'repull-models');
  assert.match(byId(c, 'models').detail, /qwen2\.5:3b/);
});

test('診斷：引擎架構與系統不符 → 警告並說明模擬執行', () => {
  const c = runDiagnostics({ ...healthy, engineArch: 'x64' });
  assert.equal(byId(c, 'engine-arch').status, 'warn');
  assert.match(byId(c, 'engine-arch').detail, /模擬/);
  assert.equal(byId(c, 'engine-arch').fix, 'reinstall-engine');
});

test('診斷：引擎檔案被修改 → 失敗並建議重新安裝引擎', () => {
  const c = runDiagnostics({ ...healthy, engineFileOk: false });
  assert.equal(byId(c, 'engine-file').status, 'fail');
  assert.equal(byId(c, 'engine-file').fix, 'reinstall-engine');
});

test('診斷：司法院連不上 → 失敗並建議檢查 VPN（無自動修復）', () => {
  const c = runDiagnostics({ ...healthy, network: { general: true, judicial: false } });
  assert.equal(byId(c, 'net-judicial').status, 'fail');
  assert.equal(byId(c, 'net-judicial').fix, 'check-network-vpn');
});

test('診斷：磁碟不足 → 失敗，且不自動修復（需使用者清空間）', () => {
  const c = runDiagnostics({ ...healthy, freeDiskGB: 1, requiredDiskGB: 3 });
  assert.equal(byId(c, 'disk').status, 'fail');
  assert.equal(byId(c, 'disk').fix, 'free-disk-space');
});

test('診斷：未安裝引擎 → 警告並建議安裝', () => {
  const c = runDiagnostics({ ...healthy, engineArch: null, engineFileOk: null, serviceVersion: null, installedModels: [] });
  assert.equal(byId(c, 'engine-installed').status, 'warn');
  assert.equal(byId(c, 'engine-installed').fix, 'reinstall-engine');
});

test('診斷報告：包含總結、每項狀態與建議修復，不含路徑', () => {
  const s = summarize(runDiagnostics({ ...healthy, serviceVersion: null }));
  const txt = formatDiagnosticReport(s, { appVersion: '3.1.0', moduleVersion: '1.0.0', at: '2026-01-01T00:00:00Z', osVersion: 'Windows 11' });
  assert.match(txt, /總結：失敗/);
  assert.match(txt, /restart-service/);
  assert.equal(/[A-Za-z]:\\/.test(txt), false);
});

// ---------- 模組目錄 ----------
const f = (content, url) => ({ sha256: sha(content), size: content.length, url });

test('validateCatalog：路徑跳脫、缺雜湊、網址無效都拒絕', () => {
  const ok = { catalogVersion: 1, modules: { 'ai-engine': { version: '1.1.0', requiresAppUpdate: false, files: { 'rules.json': f(Buffer.from('{}'), 'https://x/r') } } } };
  assert.equal(validateCatalog(ok).ok, true);
  const traversal = structuredClone(ok);
  traversal.modules['ai-engine'].files['../x'] = traversal.modules['ai-engine'].files['rules.json'];
  assert.equal(validateCatalog(traversal).ok, false);
  const badHash = structuredClone(ok);
  badHash.modules['ai-engine'].files['rules.json'].sha256 = 'xyz';
  assert.equal(validateCatalog(badHash).ok, false);
  const badUrl = structuredClone(ok);
  badUrl.modules['ai-engine'].files['rules.json'].url = 'ftp://x';
  assert.equal(validateCatalog(badUrl).ok, false);
});

test('planCatalogUpdate：只下載變動檔案，相同檔案沿用；已是最新則 upToDate', () => {
  const target = {
    version: '1.1.0', requiresAppUpdate: false,
    files: { 'rules.json': f(Buffer.from('new'), 'u1'), 'keep.json': f(Buffer.from('same'), 'u2') },
  };
  const installed = { version: '1.0.0', files: { 'rules.json': sha(Buffer.from('old')), 'keep.json': sha(Buffer.from('same')) } };
  const p = planCatalogUpdate('ai-engine', installed, target);
  assert.deepEqual(p.download, ['rules.json']);
  assert.deepEqual(p.reuse, ['keep.json']);
  assert.equal(p.upToDate, false);
  const same = planCatalogUpdate('ai-engine', { version: '1.1.0', files: { 'rules.json': sha(Buffer.from('new')), 'keep.json': sha(Buffer.from('same')) } }, target);
  assert.equal(same.upToDate, true);
});

test('planCatalogUpdate：requiresAppUpdate 原樣帶出（需更新應用程式）', () => {
  const p = planCatalogUpdate('crawler', { version: '1.0.0', files: {} }, { version: '2.0.0', requiresAppUpdate: true, files: { 'a.json': f(Buffer.from('a'), 'u') } });
  assert.equal(p.requiresAppUpdate, true);
});

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
