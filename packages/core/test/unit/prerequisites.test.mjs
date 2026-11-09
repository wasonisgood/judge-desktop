// 系統前置工具：發行版判讀、各發行版安裝指令、修復步驟與錯誤分類（PREREQUISITE_MISSING）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distroIdFromOsRelease, installCommandFor, prerequisiteSteps, isTarVersionOutput, classifyError, repairPlan, ENGINE_ERROR_CODES,
} from '../../dist/index.js';

test('/etc/os-release：取得 ID（含引號與無引號）', () => {
  assert.equal(distroIdFromOsRelease('NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\n'), 'ubuntu');
  assert.equal(distroIdFromOsRelease('ID="fedora"\n'), 'fedora');
  assert.equal(distroIdFromOsRelease('NAME=x\n'), null);
});

test('安裝指令：依發行版套件管理程式給出對應指令', () => {
  assert.equal(installCommandFor('debian', 'tar'), 'sudo apt install tar');
  assert.equal(installCommandFor('fedora', 'tar'), 'sudo dnf install tar');
  assert.equal(installCommandFor('opensuse-tumbleweed', 'tar'), 'sudo zypper install tar');
  assert.equal(installCommandFor('arch', 'tar'), 'sudo pacman -S tar');
  assert.equal(installCommandFor('alpine', 'tar'), 'sudo apk add tar');
  assert.equal(installCommandFor('debian', 'df'), 'sudo apt install coreutils');
  assert.match(installCommandFor('gentoo', 'tar'), /套件管理程式/);
});

test('修復步驟：沒有缺少工具時為空；有缺少時列出工具與安裝指令', () => {
  assert.deepEqual(prerequisiteSteps([], 'ubuntu'), []);
  const steps = prerequisiteSteps(['tar'], 'ubuntu');
  assert.match(steps[0], /缺少系統工具：tar/);
  assert.equal(steps[1], '安裝指令：sudo apt install tar');
});

test('tar 版本輸出判讀：GNU tar 與 bsdtar 都認得', () => {
  assert.equal(isTarVersionOutput('tar (GNU tar) 1.35\n'), true);
  assert.equal(isTarVersionOutput('bsdtar 3.5.3 - libarchive 3.5.3'), true);
  assert.equal(isTarVersionOutput('hello'), false);
});

test('錯誤分類：缺少 tar 的錯誤歸為 PREREQUISITE_MISSING，並有修復說明', () => {
  const e = new Error('系統查詢失敗（tar）：spawn tar ENOENT');
  assert.equal(classifyError(e).code, 'PREREQUISITE_MISSING');
  assert.ok(repairPlan('PREREQUISITE_MISSING').userSteps.length > 0);
  assert.ok(ENGINE_ERROR_CODES.includes('PREREQUISITE_MISSING'));
});

test('錯誤分類：無關的檔案不存在（非 tar、df）不歸為前置工具錯誤', () => {
  const e = Object.assign(new Error('ENOENT: no such file or directory, open model.bin'), { code: 'ENOENT' });
  assert.notEqual(classifyError(e).code, 'PREREQUISITE_MISSING');
});
