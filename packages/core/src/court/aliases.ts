// 判決查詢字串的整理：去除空白、「台」改「臺」、常見縮寫展開為司法院裁判書上的正式法院名稱。
// 注意：這是初版的縮寫表，只收錄常見且不會歧義的寫法；無法確定的縮寫不會自動展開。

const COURT_ALIASES: Record<string, string> = {
  高院: '臺灣高等法院',
  台灣高等法院: '臺灣高等法院',
  台高院: '臺灣高等法院',
  臺高院: '臺灣高等法院',
  最高院: '最高法院',
  最高: '最高法院',
  地院: '臺灣臺北地方法院',
  行政法院: '最高行政法院',
};

/** 去除所有空白與全形空白，並把「台」統一為「臺」（司法院使用「臺」）。 */
export function normalizeJudgmentText(s: string): string {
  return s.replace(/[\s　]+/g, '').replace(/台/g, '臺');
}

/**
 * 產生判決搜尋要用的查詢字串（可能多於一個）。
 * 例：「高院 戒嚴」→ ["臺灣高等法院戒嚴", "高院戒嚴"]（原字串也保留，避免展開錯誤時漏查）。
 */
export function judgmentQueries(input: string): string[] {
  const base = normalizeJudgmentText(input);
  const out = new Set<string>();
  if (base) out.add(base);
  for (const [abbr, full] of Object.entries(COURT_ALIASES)) {
    if (base.includes(abbr) && abbr !== full) out.add(base.split(abbr).join(full));
  }
  return [...out];
}
