// zstd 串流解壓：以程式產生的 zstd 框架（raw 區塊）與 ustar 檔案，驗證解出的位元組與系統 tar 可讀取。
// raw 區塊是 zstd 規格的一部分，因此可在沒有 zstd 壓縮工具的環境中產生有效的測試檔。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { decompressZstdFile } = require('../dist/main/services/zstdArchive.js');

/** 產生單一檔案的 ustar 封存（512 位元組表頭 + 內容 + 補齊 + 兩個空區塊）。 */
function ustar(name, content) {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.write('        ', 148, 'ascii'); // 校驗和先以空白計算
  header.write('0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512, 0);
  content.copy(body);
  return Buffer.concat([header, body, Buffer.alloc(1024, 0)]);
}

/** 以 raw 區塊產生 zstd 框架（單一框架，FCS 4 位元組）。 */
function zstdRawFrame(data, blockSize = 4096) {
  const parts = [Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0]), Buffer.alloc(4)];
  parts[1].writeUInt32LE(data.length, 0);
  for (let off = 0; off < data.length || off === 0; off += blockSize) {
    const chunk = data.subarray(off, Math.min(off + blockSize, data.length));
    const last = off + blockSize >= data.length ? 1 : 0;
    const h = Buffer.alloc(3);
    h.writeUIntLE((chunk.length << 3) | (0 << 1) | last, 0, 3); // 類型 0 = raw
    parts.push(h, chunk);
    if (last) break;
  }
  return Buffer.concat(parts);
}

test('zstd 串流解壓：解出的 tar 與原始封存完全相同（跨多個區塊）', async () => {
  const content = Buffer.from('ollama-binary-bytes\n'.repeat(400));
  const tar = Buffer.concat([ustar('bin/ollama', content), ustar('lib/readme.txt', Buffer.from('hi'))]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-zst-'));
  const zst = path.join(dir, 'engine.tar.zst');
  const out = path.join(dir, 'engine.tar');
  fs.writeFileSync(zst, zstdRawFrame(tar, 1000));
  await decompressZstdFile(zst, out);
  assert.deepEqual(fs.readFileSync(out), tar);
});

// 系統 tar 只在 macOS、Linux 上使用（Windows 的 Ollama 使用 zip），因此這項只在非 Windows 執行。
test('zstd 串流解壓：解出的 tar 可由系統 tar 列出並解開', { skip: process.platform === 'win32' }, async () => {
  const content = Buffer.from('#!/bin/sh\necho ok\n');
  const tar = ustar('bin/ollama', content);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-zst-'));
  fs.writeFileSync(path.join(dir, 'engine.tar.zst'), zstdRawFrame(tar));
  await decompressZstdFile(path.join(dir, 'engine.tar.zst'), path.join(dir, 'engine.tar'));
  const listing = execFileSync('tar', ['-tf', 'engine.tar'], { cwd: dir, encoding: 'utf8' });
  assert.match(listing, /bin\/ollama/);
  const dest = path.join(dir, 'x');
  fs.mkdirSync(dest);
  execFileSync('tar', ['-xf', 'engine.tar', '-C', dest], { cwd: dir });
  assert.deepEqual(fs.readFileSync(path.join(dest, 'bin/ollama')), content);
});

test('zstd 串流解壓：不是 zstd 的檔案會失敗，不會產生半成品以外的輸出', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-zst-'));
  const bad = path.join(dir, 'bad.zst');
  fs.writeFileSync(bad, Buffer.from('this is not zstd at all'));
  await assert.rejects(decompressZstdFile(bad, path.join(dir, 'out.tar')));
});
