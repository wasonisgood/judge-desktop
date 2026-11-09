// 跨平臺引擎資產：Windows（zip）、macOS（通用 tgz）、Linux（tar.zst）的檔名、解壓格式與執行檔名稱；架構判讀。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaAssetFor, ollamaExeName, archiveKindFor, archFromNodeArch, archFromUname } from '../../dist/index.js';

test('資產名稱：Windows 維持原本的 zip（既有行為不變）', () => {
  assert.equal(ollamaAssetFor('x64'), 'ollama-windows-amd64.zip');
  assert.equal(ollamaAssetFor('arm64', 'win32'), 'ollama-windows-arm64.zip');
  assert.equal(ollamaAssetFor('x86'), null);
});

test('資產名稱：macOS 使用通用的 ollama-darwin.tgz（Apple Silicon 與 Intel 共用）', () => {
  assert.equal(ollamaAssetFor('arm64', 'darwin'), 'ollama-darwin.tgz');
  assert.equal(ollamaAssetFor('x64', 'darwin'), 'ollama-darwin.tgz');
  assert.equal(ollamaAssetFor('x86', 'darwin'), null);
});

test('資產名稱：Linux 分 amd64 與 arm64 的 tar.zst', () => {
  assert.equal(ollamaAssetFor('x64', 'linux'), 'ollama-linux-amd64.tar.zst');
  assert.equal(ollamaAssetFor('arm64', 'linux'), 'ollama-linux-arm64.tar.zst');
  assert.equal(ollamaAssetFor('arm32', 'linux'), null);
});

test('執行檔名稱：Windows 為 ollama.exe，其餘為 ollama', () => {
  assert.equal(ollamaExeName('win32'), 'ollama.exe');
  assert.equal(ollamaExeName('darwin'), 'ollama');
  assert.equal(ollamaExeName('linux'), 'ollama');
});

test('壓縮格式：依檔名判斷 zip、tgz、tar.zst', () => {
  assert.equal(archiveKindFor('ollama-windows-amd64.zip'), 'zip');
  assert.equal(archiveKindFor('ollama-darwin.tgz'), 'tgz');
  assert.equal(archiveKindFor('ollama-linux-amd64.tar.zst'), 'tar.zst');
});

test('架構：Node 的 process.arch 與 uname -m 轉換正確', () => {
  assert.equal(archFromNodeArch('arm64'), 'arm64');
  assert.equal(archFromNodeArch('x64'), 'x64');
  assert.equal(archFromNodeArch('s390x'), 'unknown');
  assert.equal(archFromUname('aarch64\n'), 'arm64');
  assert.equal(archFromUname('x86_64'), 'x64');
  assert.equal(archFromUname('armv7l'), 'arm32');
  assert.equal(archFromUname(''), 'unknown');
});
