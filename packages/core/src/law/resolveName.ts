// 法名確認：使用者輸入的法名不完全正確時，找出最可能的正式法名。
// 做法：1) 原字串與幾個查詢變體（去掉「及」、取前段關鍵詞）分別查詢全國法規資料庫；
//       2) 合併建議，依編輯距離相似度排序；
//       3) 只有最佳結果明顯勝出時才自動採用，否則回傳候選清單讓使用者選擇。不做沒有依據的猜測。
import type { LawClient, LawNameMatch } from './client';

export interface ScoredName extends LawNameMatch {
  score: number;
}

export type NameResolution =
  | { status: 'exact'; match: LawNameMatch }
  | { status: 'auto'; match: LawNameMatch; from: string; score: number }
  | { status: 'candidates'; candidates: ScoredName[] }
  | { status: 'none' };

/**
 * 清理法名查詢字串：去掉括號內容、「第 N 條」之後的條文、以及符號（/ & ? 等）。
 * 這些符號會讓查詢網址出錯（HTTP 400／404），AI 也常會把條文寫在法名後面。
 */
export function cleanLawQuery(input: string): string {
  let t = input.replace(/[（(][^）)]*[）)]/g, '');
  const cut = t.search(/第\s*[0-9０-９一二三四五六七八九十百千零〇兩]/);
  if (cut >= 0) t = t.slice(0, cut);
  t = t.replace(/[^\p{Script=Han}\p{L}\p{N}\s]/gu, '');
  return t.replace(/\s+/g, '').trim();
}

/** 編輯距離（以字元為單位，支援中文）。 */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev.splice(0, prev.length, ...cur);
  }
  return prev[y.length];
}

/** 0 到 1 的相似度（1 為完全相同）。去除空白後比較。 */
export function similarity(a: string, b: string): number {
  const x = a.replace(/\s+/g, '');
  const y = b.replace(/\s+/g, '');
  const max = Math.max([...x].length, [...y].length);
  if (max === 0) return 1;
  return 1 - editDistance(x, y) / max;
}

/** 產生查詢變體：原字串、去掉「及」、前段關鍵詞（前 4、6 字）。去重，最多 4 個。 */
export function queryVariants(input: string): string[] {
  const t = input.replace(/\s+/g, '');
  const set = new Set<string>([t]);
  set.add(t.replace(/及/g, ''));
  const chars = [...t];
  if (chars.length > 6) set.add(chars.slice(0, 6).join(''));
  if (chars.length > 4) set.add(chars.slice(0, 4).join(''));
  return [...set].filter((s) => s.length >= 2).slice(0, 4);
}

/**
 * 依使用者輸入找出正式法名。
 * - 完全相同：exact。
 * - 最佳候選相似度 ≥ 0.8，且與第二名差距 ≥ 0.1：auto（回報原輸入與採用的正式法名，讓使用者知道）。
 * - 其他有候選：candidates（由使用者選擇）。
 * - 查不到任何候選：none。
 */
export async function resolveLawName(client: LawClient, rawInput: string): Promise<NameResolution> {
  const input = cleanLawQuery(rawInput);
  if (!input) return { status: 'none' };
  const want = input;
  const pool = new Map<string, LawNameMatch>();
  let lastError: unknown = null;
  for (const q of queryVariants(input)) {
    // 單一變體查詢失敗（網路或網站錯誤）不中斷，改試下一個變體。
    let r;
    try {
      r = await client.searchMojByName(q);
    } catch (err) {
      lastError = err;
      continue;
    }
    if (r.exact && r.exact.name.replace(/\s+/g, '') === want) return { status: 'exact', match: r.exact };
    for (const s of r.suggestions) if (!pool.has(s.pcode)) pool.set(s.pcode, s);
  }
  if (pool.size === 0) {
    if (lastError) throw lastError;
    return { status: 'none' };
  }
  const scored: ScoredName[] = [...pool.values()]
    .map((m) => ({ ...m, score: similarity(want, m.name) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best.score >= 0.8 && (!second || best.score - second.score >= 0.1)) {
    return { status: 'auto', match: { name: best.name, pcode: best.pcode }, from: input, score: best.score };
  }
  return { status: 'candidates', candidates: scored.slice(0, 5) };
}
