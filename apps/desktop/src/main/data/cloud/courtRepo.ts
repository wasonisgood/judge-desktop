// 雲端資料層（司法院）：搜尋與內頁，經本地快取取得。搜尋結果依設定天數過期；內頁永久保存。
import {
  searchJudgments, getJudgmentDetail, CourtClient, type JudgmentDetail, type JudgmentSummary,
} from '@judge/core';
import { readSettings } from '../local/settingsStore';
import { cacheGet, cachePut } from '../local/cacheStore';

export async function cachedSearch(keyword: string, maxItems: number, courtCode?: string): Promise<JudgmentSummary[]> {
  const s = await readSettings();
  const k = JSON.stringify({ keyword, maxItems, courtCode: courtCode ?? '' });
  const hit = await cacheGet<JudgmentSummary[]>('search', k, s.cacheDays * 86_400_000);
  if (hit) return hit;
  const items = await searchJudgments(keyword, { maxItems, courtCode: courtCode || undefined, client: new CourtClient() });
  await cachePut('search', k, items);
  return items;
}

export async function cachedDetail(id: string, client?: CourtClient): Promise<JudgmentDetail> {
  const hit = await cacheGet<JudgmentDetail>('detail', id, Number.MAX_SAFE_INTEGER);
  if (hit) return hit;
  const d = await getJudgmentDetail(id, client);
  await cachePut('detail', id, d);
  return d;
}
