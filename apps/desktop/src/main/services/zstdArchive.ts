// zstd 壓縮檔的串流解壓（純 JavaScript，fzstd）：不依賴系統是否安裝 zstd。
// 以串流寫出 .tar，記憶體用量只與區塊大小有關（Ollama 的 Linux 發佈檔約 1.5 GB，不能整包讀入）。
import * as fs from 'node:fs';
import { once } from 'node:events';
import { Decompress } from 'fzstd';

/** 把 .zst 串流解壓到目標檔案（例如 .tar）。寫入會遵守背壓（write 回傳 false 時等待 drain）。 */
export async function decompressZstdFile(src: string, dst: string): Promise<void> {
  const out = fs.createWriteStream(dst);
  const pending: Uint8Array[] = [];
  const dec = new Decompress((data) => { pending.push(data.slice()); });
  try {
    for await (const chunk of fs.createReadStream(src, { highWaterMark: 1024 * 1024 })) {
      dec.push(new Uint8Array(chunk as Buffer));
      for (const part of pending.splice(0)) {
        if (!out.write(part)) await once(out, 'drain');
      }
    }
    dec.push(new Uint8Array(0), true);
    for (const part of pending.splice(0)) {
      if (!out.write(part)) await once(out, 'drain');
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject);
      out.end(() => resolve());
    });
  }
}
