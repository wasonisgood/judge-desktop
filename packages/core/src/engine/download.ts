// 可續傳的下載：支援 HTTP Range 續傳、串流寫入磁碟、完成後計算 SHA-256 並校驗。
// 若伺服器不支援續傳（回 200 而非 206），會從頭重新下載，不會把舊資料和新資料接在一起。
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export interface DownloadOptions {
  url: string;
  /** 目的檔案（完整路徑）；未完成時會保留 `${file}.part` 供續傳。 */
  file: string;
  /** 若提供則校驗 SHA-256，不符時刪除檔案並拋出 HASH_MISMATCH 相關錯誤。 */
  expectedSha256?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (downloaded: number, total: number | null) => void;
  timeoutMs?: number;
}

export interface DownloadResult {
  file: string;
  bytes: number;
  sha256: string;
  resumedFrom: number;
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve());
    s.on('error', reject);
  });
  return h.digest('hex');
}

export async function downloadWithResume(opts: DownloadOptions): Promise<DownloadResult> {
  const f = opts.fetchImpl ?? fetch;
  const part = `${opts.file}.part`;
  await fsp.mkdir(path.dirname(opts.file), { recursive: true });
  let offset = 0;
  try {
    offset = (await fsp.stat(part)).size;
  } catch {
    offset = 0;
  }

  const headers: Record<string, string> = {};
  if (offset > 0) headers.range = `bytes=${offset}-`;
  const res = await f(opts.url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 30 * 60_000) });
  if (!res.ok && res.status !== 206) throw new Error(`下載失敗（HTTP ${res.status}）`);
  if (!res.body) throw new Error('下載失敗：回應沒有內容');

  // 伺服器不支援續傳（200）→ 從頭開始，捨棄舊的部分檔。
  let resumedFrom = 0;
  if (offset > 0 && res.status === 206) {
    resumedFrom = offset;
  } else {
    offset = 0;
    await fsp.rm(part, { force: true });
  }
  const total = res.headers.get('content-length');
  const totalBytes = total ? Number(total) + resumedFrom : null;

  // 先建立（或保留）部分檔：即使連線在任何資料送達前中斷，下次仍能以同一路徑續傳。
  if (resumedFrom === 0) await fsp.writeFile(part, Buffer.alloc(0));
  const out = fs.createWriteStream(part, { flags: resumedFrom > 0 ? 'a' : 'w' });
  let downloaded = resumedFrom;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      downloaded += value.byteLength;
      opts.onProgress?.(downloaded, totalBytes);
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    // 連線中斷：先把已收到的資料寫入磁碟（不可丟棄），下次才能從這個位置續傳。
    await new Promise<void>((r) => out.end(() => r()));
    throw e;
  }

  if (totalBytes !== null && downloaded !== totalBytes) {
    throw new Error(`下載不完整（${downloaded}/${totalBytes} bytes），可重試續傳`);
  }
  const sha256 = await sha256File(part);
  if (opts.expectedSha256 && sha256 !== opts.expectedSha256.toLowerCase()) {
    await fsp.rm(part, { force: true });
    throw new Error(`雜湊校驗失敗：檔案內容與預期不符（HASH_MISMATCH），已刪除，請重新下載`);
  }
  await fsp.rm(opts.file, { force: true });
  await fsp.rename(part, opts.file);
  return { file: opts.file, bytes: downloaded, sha256, resumedFrom };
}
