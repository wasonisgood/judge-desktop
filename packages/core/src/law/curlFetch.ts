// 以系統的 curl 發出請求，回傳標準的 Response。
// 用途：立法院法律系統（lis.ly.gov.tw）伺服器不支援 Node 預設要求的「安全重新協商」，
// Node 的 fetch 會拒絕連線。Windows 內建的 curl（使用系統的 Schannel TLS）可以正常連線。
// 注意：本函式「不」關閉憑證驗證，也不加入任何降低安全性的參數。
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

export interface CurlFetchOptions {
  /** curl 執行檔；預設 "curl"（Windows 10 1803 以後內建 curl.exe）。 */
  curlBin?: string;
  /** 暫存目錄；預設為系統暫存目錄。 */
  tmpDir?: string;
  timeoutSeconds?: number;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`curl 執行失敗：${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

/** 解析 curl -D 寫出的標頭（不跟隨轉址，因此只會有一組標頭）。 */
function parseHeaderBlock(raw: string): { status: number; headers: Headers } {
  const lines = raw.split(/\r?\n/);
  let status = 0;
  const headers = new Headers();
  for (const line of lines) {
    if (/^HTTP\//.test(line)) {
      status = Number(line.split(' ')[1]) || 0;
      continue;
    }
    const i = line.indexOf(':');
    if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return { status, headers };
}

export function createCurlFetch(opts: CurlFetchOptions = {}): typeof fetch {
  const bin = opts.curlBin ?? 'curl';
  const timeout = opts.timeoutSeconds ?? 30;

  return (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const dir = await fs.mkdtemp(path.join(opts.tmpDir ?? tmpdir(), 'jd-curl-'));
    try {
      const hdrFile = path.join(dir, 'headers.txt');
      const bodyFile = path.join(dir, 'body.bin');
      const args = [
        '-s', '-S',
        '--max-time', String(timeout),
        '-X', method,
        '-D', hdrFile,
        '-o', bodyFile,
        '-w', '%{http_code}',
      ];
      const headers = new Headers(init.headers);
      headers.forEach((v, k) => args.push('-H', `${k}: ${v}`));

      if (init.body !== undefined && init.body !== null) {
        const inFile = path.join(dir, 'request.bin');
        const buf = typeof init.body === 'string' || init.body instanceof URLSearchParams
          ? Buffer.from(init.body.toString(), 'utf8')
          : Buffer.from(init.body as ArrayBuffer);
        await fs.writeFile(inFile, buf);
        args.push('--data-binary', `@${inFile}`);
      }
      args.push(url);

      // curl -w 會把 HTTP 狀態碼印在 stdout；標頭與內容分別寫入檔案。
      const statusText = (await run(bin, args)).trim();
      const headerRaw = await fs.readFile(hdrFile, 'utf8').catch(() => '');
      const parsed = parseHeaderBlock(headerRaw);
      const status = Number(statusText) || parsed.status;
      const body = await fs.readFile(bodyFile).catch(() => Buffer.alloc(0));
      const nullBody = status === 204 || status === 205 || status === 304 || (status >= 300 && status < 400);
      return new Response(nullBody ? null : body, { status, headers: parsed.headers });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }) as typeof fetch;
}
