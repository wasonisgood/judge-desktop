// 跨平臺系統查詢的解析函式：df 可用空間、/proc/meminfo 總記憶體（純函式，不需要 Electron）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseDfAvailableBytes, parseMemTotalBytes } = require('../dist/main/data/local/system.js');

test('df -Pk：取第二行第四欄（可用 1K 區塊）換算為位元組', () => {
  const out = 'Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/disk3s1   971350180 512000000 459350180      53% /\n';
  assert.equal(parseDfAvailableBytes(out), 459350180 * 1024);
});

test('df -Pk：無法解析時拋錯，不會回傳 0 造成誤判', () => {
  assert.throws(() => parseDfAvailableBytes('Filesystem\n'), /無法解析磁碟可用空間/);
});

test('/proc/meminfo：MemTotal（kB）換算為位元組', () => {
  const meminfo = 'MemTotal:       16318284 kB\nMemFree:         1234 kB\n';
  assert.equal(parseMemTotalBytes(meminfo), 16318284 * 1024);
});

test('/proc/meminfo：缺少 MemTotal 時拋錯', () => {
  assert.throws(() => parseMemTotalBytes('MemFree: 1 kB\n'), /無法解析 MemTotal/);
});
