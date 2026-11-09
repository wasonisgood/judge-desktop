// v31 單元測試（一）：架構判讀、GitHub 資產、規則表、版本比較與模型清單。
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

