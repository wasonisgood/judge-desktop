// 引擎穩定性測試：串流解析、錯誤分類、重試、可續傳下載（真的本機 HTTP 伺服器）、健康檢查與自動啟動、修復步驟、簽章判讀。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  readNdjsonStream, NdjsonParseError, classifyError, withRetry,
  downloadWithResume, sha256File, ensureEngineRunning, repairPlan,
  parseSignatureJson, isTrustedSignature,
} from '../../dist/index.js';

// ---------- 串流 NDJSON ----------
function streamOf(chunks) {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
      c.close();
    },
  });
}

test('readNdjsonStream：跨 chunk 的行會正確拼接（不會在 chunk 邊界斷行）', async () => {
  const got = [];
  const n = await readNdjsonStream(streamOf(['{"stat', 'us":"a"}\n{"status"', ':"b"}\n']), (o) => got.push(o));
  assert.equal(n, 2);
  assert.deepEqual(got, [{ status: 'a' }, { status: 'b' }]);
});

test('readNdjsonStream：最後一行沒有換行也會解析', async () => {
  const got = [];
  await readNdjsonStream(streamOf(['{"a":1}\r\n{"b":2}']), (o) => got.push(o));
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }]);
});

test('readNdjsonStream：壞行拋出 NdjsonParseError 並指出行號', async () => {
  await assert.rejects(
    readNdjsonStream(streamOf(['{"a":1}\n', 'oops\n']), () => {}),
    (e) => e instanceof NdjsonParseError && e.lineNo === 2,
  );
});

// ---------- 錯誤分類 ----------
test('classifyError：磁碟滿、權限、逾時、網路、服務、簽章、雜湊', () => {
  assert.equal(classifyError({ code: 'ENOSPC', message: 'x' }).code, 'DISK_FULL');
  assert.equal(classifyError({ code: 'EPERM', message: 'x' }).code, 'PERMISSION');
  assert.equal(classifyError({ name: 'TimeoutError', message: 'x' }).code, 'TIMEOUT');
  assert.equal(classifyError({ cause: { code: 'ECONNRESET' }, message: 'fetch failed' }).code, 'NETWORK');
  assert.equal(classifyError({ code: 'ECONNREFUSED', message: 'x' }).code, 'SERVICE_DOWN');
  assert.equal(classifyError(new Error('簽章狀態為 NotSigned')).code, 'SIGNATURE_INVALID');
  assert.equal(classifyError(new Error('雜湊校驗失敗')).code, 'HASH_MISMATCH');
  assert.equal(classifyError(new Error('完全不認識的錯誤')).code, 'UNKNOWN');
});

test('classifyError：可重試與否的判定正確', () => {
  assert.equal(classifyError({ code: 'ENOSPC' }).retryable, false);
  assert.equal(classifyError({ code: 'ECONNRESET' }).retryable, true);
  assert.equal(classifyError({ code: 'EACCES' }).retryable, false);
});

// ---------- 重試 ----------
test('withRetry：可重試錯誤會重試直到成功，且退避時間倍增', async () => {
  let calls = 0;
  const delays = [];
  const v = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('x'), { code: 'ECONNRESET' });
      return 'ok';
    },
    { attempts: 5, baseDelayMs: 100, sleep: async (ms) => delays.push(ms) },
  );
  assert.equal(v, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('withRetry：不可重試錯誤（磁碟滿）立即拋出，不重試', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); }, { attempts: 5, sleep: async () => {} }),
    /no space/,
  );
  assert.equal(calls, 1);
});

test('withRetry：超過次數後拋出最後一次的錯誤', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw Object.assign(new Error('net'), { code: 'ECONNRESET' }); }, { attempts: 3, sleep: async () => {} }),
    /net/,
  );
  assert.equal(calls, 3);
});

// ---------- 可續傳下載（真的本機 HTTP 伺服器） ----------
function startFileServer(buf, opts = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ range: req.headers.range ?? null });
    if (opts.failAfterBytes && !req.headers.range) {
      // 第一次請求：送出一部分後中斷，模擬網路中斷。
      res.writeHead(200, { 'content-length': buf.length });
      // 確定部分資料送出後才斷線（確定性，不依賴計時器）。
      // 已送出部分資料後以 FIN 結束連線（資料順序保證送達），模擬網路中斷。
      // 先送出部分資料，停頓一下讓用戶端收到，再以 FIN 結束連線，模擬下載途中斷線。
      res.write(buf.subarray(0, opts.failAfterBytes), () => setTimeout(() => req.socket.end(), 300));
      return;
    }
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    if (m && !opts.ignoreRange) {
      const start = Number(m[1]);
      res.writeHead(206, { 'content-length': buf.length - start, 'content-range': `bytes ${start}-${buf.length - 1}/${buf.length}` });
      res.end(buf.subarray(start));
    } else {
      res.writeHead(200, { 'content-length': buf.length });
      res.end(buf);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, hits, url: `http://127.0.0.1:${server.address().port}/f.bin` })));
}

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'judge-dl-'));
}

test('downloadWithResume：完整下載並校驗 SHA-256', async () => {
  const buf = Buffer.alloc(300_000, 7);
  const { server, url } = await startFileServer(buf);
  try {
    const dir = await tmpDir();
    const file = path.join(dir, 'x.bin');
    const expected = createHash('sha256').update(buf).digest('hex');
    const r = await downloadWithResume({ url, file, expectedSha256: expected });
    assert.equal(r.bytes, buf.length);
    assert.equal(r.resumedFrom, 0);
    assert.equal(await sha256File(file), expected);
    assert.equal(fs.existsSync(`${file}.part`), false);
  } finally {
    server.close();
  }
});

test('downloadWithResume：中斷後保留 .part，下次用 Range 續傳（不重下載前半段）', async () => {
  const buf = Buffer.alloc(200_000);
  for (let i = 0; i < buf.length; i++) buf[i] = i % 251;
  const { server, hits, url } = await startFileServer(buf, { failAfterBytes: 50_000 });
  try {
    const dir = await tmpDir();
    const file = path.join(dir, 'y.bin');
    await assert.rejects(downloadWithResume({ url, file }));
    const partSize = fs.statSync(`${file}.part`).size;
    assert.ok(partSize > 0 && partSize < buf.length, `部分檔大小應介於 0 與全長之間，實際 ${partSize}`);
    const r = await downloadWithResume({ url, file, expectedSha256: createHash('sha256').update(buf).digest('hex') });
    assert.equal(r.resumedFrom, partSize);
    assert.equal(hits[1].range, `bytes=${partSize}-`, '第二次請求必須帶 Range');
    assert.equal(await sha256File(file), createHash('sha256').update(buf).digest('hex'));
  } finally {
    server.close();
  }
});

test('downloadWithResume：伺服器不支援續傳（回 200）→ 從頭重下，不會把新舊資料接在一起', async () => {
  const buf = Buffer.alloc(120_000, 3);
  const { server, url } = await startFileServer(buf, { ignoreRange: true });
  try {
    const dir = await tmpDir();
    const file = path.join(dir, 'z.bin');
    await fsp.writeFile(`${file}.part`, Buffer.alloc(5000, 9)); // 假的舊部分檔
    const r = await downloadWithResume({ url, file, expectedSha256: createHash('sha256').update(buf).digest('hex') });
    assert.equal(r.resumedFrom, 0);
    assert.equal(r.bytes, buf.length);
  } finally {
    server.close();
  }
});

test('downloadWithResume：雜湊不符 → 刪除檔案並拋錯（不留下壞檔）', async () => {
  const buf = Buffer.alloc(10_000, 1);
  const { server, url } = await startFileServer(buf);
  try {
    const dir = await tmpDir();
    const file = path.join(dir, 'bad.bin');
    await assert.rejects(downloadWithResume({ url, file, expectedSha256: 'a'.repeat(64) }), /雜湊校驗失敗/);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(`${file}.part`), false);
  } finally {
    server.close();
  }
});

test('downloadWithResume：進度回報單調遞增，最後等於總長', async () => {
  const buf = Buffer.alloc(150_000, 5);
  const { server, url } = await startFileServer(buf);
  try {
    const dir = await tmpDir();
    const seen = [];
    await downloadWithResume({ url, file: path.join(dir, 'p.bin'), onProgress: (d, t) => seen.push([d, t]) });
    assert.ok(seen.length >= 1);
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] >= seen[i - 1][0]);
    assert.equal(seen.at(-1)[0], buf.length);
    assert.equal(seen.at(-1)[1], buf.length);
  } finally {
    server.close();
  }
});

// ---------- 健康檢查與自動啟動 ----------
test('ensureEngineRunning：服務已在執行 → 不呼叫啟動', async () => {
  let started = 0;
  const h = await ensureEngineRunning({ probe: async () => '0.5.1', startService: () => { started++; }, sleep: async () => {} });
  assert.equal(h.ok, true);
  assert.equal(started, 0);
});

test('ensureEngineRunning：沒在執行 → 啟動後輪詢到回應', async () => {
  let up = false;
  let started = 0;
  let probes = 0;
  const h = await ensureEngineRunning({
    probe: async () => { probes++; return up ? '0.5.1' : null; },
    startService: () => { started++; up = true; },
    sleep: async () => {},
    maxWaitMs: 60_000,
  });
  assert.equal(h.ok, true);
  assert.equal(h.startAttempts, 1);
  assert.equal(started, 1);
  assert.ok(probes >= 2);
});

test('ensureEngineRunning：啟動失敗 → 嘗試次數用完後回報 ok=false', async () => {
  let t = 0;
  let started = 0;
  const h = await ensureEngineRunning({
    probe: async () => null,
    startService: () => { started++; },
    sleep: async (ms) => { t += ms; },
    now: () => t,
    maxWaitMs: 10_000,
    maxStartAttempts: 2,
  });
  assert.equal(h.ok, false);
  assert.equal(started, 2);
});

test('ensureEngineRunning：沒有提供 startService 時只檢查、不啟動', async () => {
  const h = await ensureEngineRunning({ probe: async () => null, sleep: async () => {} });
  assert.equal(h.ok, false);
  assert.equal(h.startAttempts, 0);
});

// ---------- 修復步驟 ----------
test('repairPlan：每個錯誤代碼都有修復說明（不得空白）', () => {
  for (const code of ['DISK_FULL', 'PERMISSION', 'NETWORK', 'TIMEOUT', 'SERVICE_DOWN', 'INSTALLER_FAILED', 'SIGNATURE_INVALID', 'HASH_MISMATCH', 'PULL_FAILED', 'UNKNOWN']) {
    const p = repairPlan(code);
    assert.ok(p.userSteps.length > 0 || p.automatic.length > 0, code);
  }
});

test('repairPlan：服務沒回應 → 自動重啟；磁碟滿 → 沒有自動動作，要求使用者清空間', () => {
  assert.ok(repairPlan('SERVICE_DOWN').automatic.includes('restart-service'));
  const d = repairPlan('DISK_FULL');
  assert.equal(d.automatic.length, 0);
  assert.match(d.userSteps.join(), /磁碟/);
});

// ---------- 簽章判讀 ----------
test('parseSignatureJson + isTrustedSignature：有效且發行者相符才通過', () => {
  const r = parseSignatureJson(JSON.stringify({ Status: 'Valid', Subject: 'CN=Ollama, O=Ollama Inc.' }));
  assert.equal(isTrustedSignature(r, 'Ollama').ok, true);
});

test('isTrustedSignature：狀態不是 Valid → 拒絕', () => {
  const r = parseSignatureJson(JSON.stringify({ Status: 'NotSigned', Subject: null }));
  const res = isTrustedSignature(r, 'Ollama');
  assert.equal(res.ok, false);
  assert.match(res.reason, /NotSigned/);
});

test('isTrustedSignature：簽署者不符 → 拒絕', () => {
  const r = parseSignatureJson(JSON.stringify({ Status: 'Valid', Subject: 'CN=Someone Else' }));
  assert.equal(isTrustedSignature(r, 'Ollama').ok, false);
});
