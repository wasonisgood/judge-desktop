// 雲端資料層（法院）：搜尋與內頁，經本地快取取得。搜尋結果依設定天數過期；內頁永久保存。
// 管轄區：未指定或為預設（台灣司法院）時，快取鍵與呼叫方式與過去完全相同（既有快取不失效）；
// 其他管轄區的快取鍵加上管轄區識別碼，避免與台灣的判決互相覆蓋。
import {
  searchJudgments, getJudgmentDetail, CourtClient, jurisdictionRegistry, DEFAULT_JURISDICTION_ID, judgmentHasBody,
  type JudgmentDetail, type JudgmentSummary, type JurisdictionId,
} from '@judge/core';
import { readSettings } from '../local/settingsStore';
import { cacheGet, cachePut } from '../local/cacheStore';

const isDefault = (jid: JurisdictionId) => jid === DEFAULT_JURISDICTION_ID;

export async function cachedSearch(keyword: string, maxItems: number, courtCode?: string, jurisdiction?: JurisdictionId): Promise<JudgmentSummary[]> {
  const s = await readSettings();
  const jid = jurisdiction ?? DEFAULT_JURISDICTION_ID;
  const base = { keyword, maxItems, courtCode: courtCode ?? '' };
  const k = JSON.stringify(isDefault(jid) ? base : { ...base, jurisdiction: jid });
  const hit = await cacheGet<JudgmentSummary[]>('search', k, s.cacheDays * 86_400_000);
  if (hit) return hit;
  const items = isDefault(jid)
    ? await searchJudgments(keyword, { maxItems, courtCode: courtCode || undefined, client: new CourtClient() })
    : await jurisdictionRegistry.get(jid).search(keyword, { maxItems });
  await cachePut('search', k, items);
  return items;
}

export async function cachedDetail(id: string, client?: CourtClient, jurisdiction?: JurisdictionId): Promise<JudgmentDetail> {
  const jid = jurisdiction ?? DEFAULT_JURISDICTION_ID;
  const k = isDefault(jid) ? id : `${jid}:${id}`;
  const hit = await cacheGet<JudgmentDetail>('detail', k, Number.MAX_SAFE_INTEGER);
  if (hit) return hit;
  const d = isDefault(jid)
    ? await getJudgmentDetail(id, client)
    : await jurisdictionRegistry.get(jid).getDetail(id, { client });
  // 沒有原文的內頁（例如判決編號不存在）不寫入快取，避免之後永久沿用空白結果。
  if (judgmentHasBody(d)) await cachePut('detail', k, d);
  return d;
}
