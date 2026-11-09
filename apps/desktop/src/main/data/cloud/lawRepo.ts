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

export type StatuteResolution =
  | { status: 'ok'; name: string; pcode: string; note?: string }
  | { status: 'candidates'; candidates: string[] };

/** 把使用者輸入的法名確認為正式法名；有多個候選時回傳候選清單，讓使用者選（issue #4 第 3 點）。 */
export async function resolveStatuteOrCandidates(name: string): Promise<StatuteResolution> {
  const key = name.trim();
  const hit = await cacheGet<{ name: string; pcode: string; note?: string }>('law-name', key, FOREVER);
  if (hit) return { status: 'ok', ...hit };
  const r = await resolveLawName(lawClient(), key);
  if (r.status === 'exact') {
    const out = { name: r.match.name, pcode: r.match.pcode };
    await cachePut('law-name', key, out);
    return { status: 'ok', ...out };
  }
  if (r.status === 'auto') {
    const out = { name: r.match.name, pcode: r.match.pcode, note: `「${key}」不是完整的正式法名，已採用最接近的「${r.match.name}」。` };
    await cachePut('law-name', key, out);
    return { status: 'ok', ...out };
  }
  if (r.status === 'candidates') return { status: 'candidates', candidates: r.candidates.map((x) => x.name) };
  throw new Error(`法規名稱「${key}」在全國法規資料庫中查無結果。請確認法名，例如「國家賠償法」。`);
}

/** 只要求單一結果的版本（舊呼叫端使用）；有候選時拋出含候選清單的錯誤。 */
export async function resolveStatute(name: string): Promise<{ name: string; pcode: string; note?: string }> {
  const r = await resolveStatuteOrCandidates(name);
  if (r.status === 'candidates') throw new Error(`法規名稱「${name.trim()}」找不到完全相同的法規，請選擇：${r.candidates.join('、')}`);
  return { name: r.name, pcode: r.pcode, note: r.note };
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
