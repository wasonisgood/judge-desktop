// 雲端資料層（法規）：法名確認（永久）、法條沿革（永久）、現行法規全文（30 天）。
// 法規來源以系統 curl 連線（立法院站不支援 Node 預設的 TLS 設定），仍保持憑證驗證。
import {
  LawClient, createCurlFetch, resolveLawName, type HistoryArticle, type CurrentLaw,
} from '@judge/core';
import { cacheGet, cachePut } from '../local/cacheStore';

export const LAW_CURRENT_TTL_MS = 30 * 86_400_000;
export const FOREVER = Number.MAX_SAFE_INTEGER;

export function lawClient(): LawClient {
  return new LawClient({ fetchImpl: createCurlFetch() });
}

/** 把使用者輸入的法名確認為全國法規資料庫的正式法名。完全相同或明顯相近時自動採用（會回報），否則列出候選讓使用者選。 */
export async function resolveStatute(name: string): Promise<{ name: string; pcode: string; note?: string }> {
  const key = name.trim();
  const hit = await cacheGet<{ name: string; pcode: string; note?: string }>('law-name', key, FOREVER);
  if (hit) return hit;
  const r = await resolveLawName(lawClient(), key);
  if (r.status === 'exact') {
    const out = { name: r.match.name, pcode: r.match.pcode };
    await cachePut('law-name', key, out);
    return out;
  }
  if (r.status === 'auto') {
    const out = { name: r.match.name, pcode: r.match.pcode, note: `「${key}」不是完整的正式法名，已採用最接近的「${r.match.name}」。` };
    await cachePut('law-name', key, out);
    return out;
  }
  if (r.status === 'candidates') {
    const hint = r.candidates.map((x) => x.name).join('、');
    throw new Error(`法規名稱「${key}」找不到完全相同的法規，請選擇：${hint}`);
  }
  throw new Error(`法規名稱「${key}」在全國法規資料庫中查無結果。請確認法名，例如「國家賠償法」。`);
}

export async function lawHistoryFor(lawName: string): Promise<HistoryArticle[]> {
  const hit = await cacheGet<HistoryArticle[]>('law-history', lawName, FOREVER);
  if (hit) return hit;
  const { history } = await lawClient().fetchLawHistory(lawName);
  await cachePut('law-history', lawName, history);
  return history;
}

export async function currentLawFor(pcode: string): Promise<CurrentLaw> {
  const hit = await cacheGet<CurrentLaw>('law-current', pcode, LAW_CURRENT_TTL_MS);
  if (hit) return hit;
  const law = await lawClient().fetchCurrentLaw(pcode);
  await cachePut('law-current', pcode, law);
  return law;
}
