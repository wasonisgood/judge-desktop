// 多來源下載：依序嘗試（例如先 Firebase Storage 鏡像，再 GitHub）。
// 每個來源都必須通過 SHA-256 校驗才會被接受；失敗就換下一個來源，全部失敗才拋錯。
import { downloadWithResume, type DownloadOptions } from './download';

export interface FallbackDownloadOptions extends Omit<DownloadOptions, 'url'> {
  /** 依優先順序排列的來源網址。 */
  urls: string[];
}

export interface FallbackDownloadResult {
  source: string;
  attempts: { url: string; error: string | null }[];
  result: Awaited<ReturnType<typeof downloadWithResume>>;
}

export async function downloadFromFirstAvailable(opts: FallbackDownloadOptions): Promise<FallbackDownloadResult> {
  const urls = opts.urls.filter((u) => /^https?:\/\//.test(u));
  if (urls.length === 0) throw new Error('沒有可用的下載來源');
  const attempts: { url: string; error: string | null }[] = [];
  for (const url of urls) {
    try {
      const { urls: _u, ...rest } = opts;
      const result = await downloadWithResume({ ...rest, url });
      attempts.push({ url, error: null });
      return { source: url, attempts, result };
    } catch (e: any) {
      attempts.push({ url, error: e?.message ?? String(e) });
    }
  }
  throw new Error(`所有下載來源都失敗：${attempts.map((a) => `${new URL(a.url).host}（${a.error}）`).join('；')}`);
}
