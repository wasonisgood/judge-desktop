// 多來源下載與鏡像網址測試（真的本機 HTTP 伺服器）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadFromFirstAvailable, firebaseMirrorUrl, releaseObjectPath, latestObjectPath, FIREBASE_BUCKET } from '../../dist/index.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
async function tmp() { return path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'judge-mirror-')), 'f.zip'); }

test('第一來源失敗（500）→ 自動改用第二來源', async () => {
  const body = Buffer.from('engine-bytes'.repeat(100));
  const bad = await serve((req, res) => { res.writeHead(500); res.end(); });
  const good = await serve((req, res) => { res.writeHead(200, { 'content-length': body.length }); res.end(body); });
  try {
    const r = await downloadFromFirstAvailable({ urls: [`${bad.base}/a`, `${good.base}/a`], file: await tmp(), expectedSha256: sha(body) });
    assert.equal(r.source, `${good.base}/a`);
    assert.equal(r.attempts.length, 2);
    assert.notEqual(r.attempts[0].error, null);
    assert.equal(r.attempts[1].error, null);
  } finally { bad.server.close(); good.server.close(); }
});

test('第一來源內容損毀（雜湊不符）→ 不接受，改用第二來源', async () => {
  const body = Buffer.from('correct-bytes'.repeat(100));
  const corrupt = await serve((req, res) => { const b = Buffer.from('corrupt!'.repeat(100)); res.writeHead(200, { 'content-length': b.length }); res.end(b); });
  const good = await serve((req, res) => { res.writeHead(200, { 'content-length': body.length }); res.end(body); });
  try {
    const f = await tmp();
    const r = await downloadFromFirstAvailable({ urls: [`${corrupt.base}/x`, `${good.base}/x`], file: f, expectedSha256: sha(body) });
    assert.equal(r.source, `${good.base}/x`);
    assert.match(r.attempts[0].error, /雜湊/);
    assert.equal(await fsp.readFile(f).then((b) => sha(b)), sha(body));
  } finally { corrupt.server.close(); good.server.close(); }
});

test('所有來源都失敗 → 拋錯並列出每個來源', async () => {
  const bad = await serve((req, res) => { res.writeHead(404); res.end(); });
  try {
    await assert.rejects(
      downloadFromFirstAvailable({ urls: [`${bad.base}/1`, `${bad.base}/2`], file: await tmp(), expectedSha256: 'a'.repeat(64) }),
      /所有下載來源都失敗/,
    );
  } finally { bad.server.close(); }
});

test('沒有有效網址 → 拋錯', async () => {
  await assert.rejects(downloadFromFirstAvailable({ urls: ['ftp://x'], file: await tmp(), expectedSha256: 'a'.repeat(64) }), /沒有可用的下載來源/);
});

test('鏡像網址格式：Firebase Storage 公開下載網址（路徑已編碼）', () => {
  const u = firebaseMirrorUrl(releaseObjectPath('v3.2.0', 'module-ai-engine-rules.json'));
  assert.equal(u, `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/judge-desktop%2Fv3.2.0%2Fmodule-ai-engine-rules.json?alt=media`);
  assert.equal(latestObjectPath('modules.json'), 'judge-desktop/latest/modules.json');
});
