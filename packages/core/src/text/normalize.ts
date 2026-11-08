// 文字正規化與民國年轉換。移植自 crawler.py 的 _clean_text、_iso_from_minguo、_reflow_text（簡化版）。

/** 清除 HTML 殘留的不可見字元與多餘空白。 */
export function cleanText(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** 民國日期（114.3.5 或 114年3月5日）轉西元 ISO 字串。 */
export function isoFromMinguo(s: string): string | null {
  const m = /(\d{2,3})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 重排判決全文：把因版面折行而被切斷的句子接回去。
 * 規則：段落標題（如「主文」「理由」「壹、」）獨立成行；其餘行若不以句末標點結尾，與下一行合併。
 */
export function reflowText(raw: string): string {
  if (!raw) return '';
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const isHeading = (l: string) => /^(主\s*文|事\s*實\s*及\s*理\s*由|理\s*由|據\s*上\s*論\s*結|[壹貳參肆伍一二三四五六七八九十]+\s*、)/.test(l) || l.length <= 12 && /[:：]$/.test(l);
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && !isHeading(line) && !/[。；：!?！？」）)]$/.test(prev) && !isHeading(prev)) {
      out[out.length - 1] = prev + line;
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}
