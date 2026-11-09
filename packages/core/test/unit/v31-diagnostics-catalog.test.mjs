// v31 單元測試（二）：排除問題的判讀、報告格式與模組目錄。
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

