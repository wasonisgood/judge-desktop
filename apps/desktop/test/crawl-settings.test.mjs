// 文本擷取的連線間隔設定：預設 3 秒、下限 3 秒，經由設定 IPC 寫入與讀回。
// 以 electron 的最小替身執行（不啟動 Electron）；設定檔寫到暫存資料夾。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const userData = mkdtempSync(join(tmpdir(), 'crawl-settings-'));
const handlers = {};
const electronStub = {
  app: { getPath: () => userData, isPackaged: true },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' },
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
};
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};

const store = require('../dist/main/data/local/settingsStore.js');
require('../dist/main/ipc/settingsIpc.js').registerSettingsIpc();
const settingsFile = join(userData, 'settings.json');

test('預設：沒有設定檔時連線間隔為 3 秒', async () => {
  const s = await store.readSettings();
  assert.equal(s.crawlIntervalSec, 3);
  assert.equal(store.DEFAULTS.crawlIntervalSec, 3);
});

test('寫入：低於 3 秒自動調整為 3；合理值原樣保存並可讀回', async () => {
  await handlers['settings:set'](null, { crawlIntervalSec: 1 });
  assert.equal((await handlers['settings:get']()).crawlIntervalSec, 3);
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).crawlIntervalSec, 3);

  await handlers['settings:set'](null, { crawlIntervalSec: 5 });
  assert.equal((await handlers['settings:get']()).crawlIntervalSec, 5);

  await handlers['settings:set'](null, { crawlIntervalSec: 'abc' });
  assert.equal((await handlers['settings:get']()).crawlIntervalSec, 3);
});

test('讀取：設定檔內若有低於 3 的值（手動編輯）仍以 3 為下限', async () => {
  writeFileSync(settingsFile, JSON.stringify({ crawlIntervalSec: 2 }), 'utf8');
  assert.equal((await store.readSettings()).crawlIntervalSec, 3);
  writeFileSync(settingsFile, JSON.stringify({ crawlIntervalSec: 8 }), 'utf8');
  assert.equal((await store.readSettings()).crawlIntervalSec, 8);
});
