// 本地資料層：快取（userData/cache）。每一筆以 sha256(key) 命名的 JSON 檔保存。
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { userPath } from './paths';

export const cacheDir = () => userPath('cache');

export function cacheKey(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** 讀取快取；超過 maxAgeMs 視為過期（回傳 null）。 */
export async function cacheGet<T>(kind: string, key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const file = path.join(cacheDir(), kind, cacheKey(key) + '.json');
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs > maxAgeMs) return null;
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function cachePut(kind: string, key: string, value: unknown) {
  const dir = path.join(cacheDir(), kind);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, cacheKey(key) + '.json'), JSON.stringify(value), 'utf8');
}

export async function cacheClear(): Promise<void> {
  await fs.rm(cacheDir(), { recursive: true, force: true });
}
