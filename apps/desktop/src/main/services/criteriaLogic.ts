// 納入／排除核查（issue #12）的桌面端純函式：畫面輸入整理、候選判決整理、依據明細列。不依賴 Electron，可直接以 node 測試。
import { validateCriteria, type CaseInput, type Criterion, type CriteriaRun, type CriterionMethod } from '@judge/core';

const SPLIT_KEYWORDS = /[,，、;；\n]+/;

/** 整理畫面送來的標準列表：略過完全空白的列、補上識別碼、程式判斷的關鍵字去除空白，最後交給核心驗證。 */
export function parseCriteriaInput(raw: unknown): Criterion[] {
  if (!Array.isArray(raw)) throw new Error('標準格式不正確');
  const rows = raw
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .map((x) => ({
      kind: x.kind === 'exclude' ? 'exclude' as const : 'include' as const,
      text: String(x.text ?? '').trim(),
      method: (x.method === 'program' ? 'program' : 'ai') as CriterionMethod,
      keywords: (Array.isArray(x.keywords) ? x.keywords.map(String) : String(x.keywords ?? '').split(SPLIT_KEYWORDS))
        .map((k) => k.trim())
        .filter(Boolean),
      keywordMode: x.keywordMode === 'all' ? 'all' as const : 'any' as const,
    }))
    .filter((x) => x.text || x.keywords.length);
  const criteria: Criterion[] = rows.map((x, i) => (
    x.method === 'program'
      ? { id: `c${i + 1}`, kind: x.kind, text: x.text, method: 'program', keywords: x.keywords, keywordMode: x.keywordMode }
      : { id: `c${i + 1}`, kind: x.kind, text: x.text, method: 'ai' }
  ));
  const errors = validateCriteria(criteria);
  if (errors.length) throw new Error(errors.join('；'));
  return criteria;
}

/** 從已保存的「檔案」項目取出候選判決 id：列表取 items，範圍整理取各工作表的判決列。 */
export function candidateIdsOf(kind: string, payload: unknown): string[] {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  let ids: string[] = [];
  if (kind === 'list') {
    ids = (Array.isArray(p.items) ? p.items : []).map((it) => String((it as { id?: unknown })?.id ?? ''));
  } else if (kind === 'scope') {
    ids = (Array.isArray(p.sheets) ? p.sheets : []).flatMap((s) => {
      const rows = (s as { rows?: unknown })?.rows;
      return Array.isArray(rows) ? rows.map((r) => String((r as { id?: unknown })?.id ?? '')) : [];
    });
  }
  return [...new Set(ids.filter(Boolean))];
}

/** 已有全文的候選不需要再讀取（列表全文模式或先前的核查已快取）。 */
export function needsFetch(id: string, details: Record<string, { fullText?: string } | undefined>): boolean {
  return !details[id]?.fullText?.trim();
}

interface DetailLike {
  meta?: { caseNo?: string | null; title?: string; dateIso?: string | null };
  fullText?: string;
}

/** 組出核心需要的候選案件。沒有全文時 fullText 為空，核心會把該案的 AI 與關鍵字判斷都視為無法判斷。 */
export function toCaseInput(id: string, detail: DetailLike | undefined, summary?: { title?: string; dateIso?: string | null }): CaseInput {
  return {
    id,
    caseNo: detail?.meta?.caseNo ?? detail?.meta?.title ?? summary?.title ?? null,
    dateIso: detail?.meta?.dateIso ?? summary?.dateIso ?? null,
    fullText: detail?.fullText ?? '',
  };
}

/** 依據明細（每案每條標準一列），供 Excel「依據原文」工作表與測試使用。 */
export function evidenceRows(run: CriteriaRun): string[][] {
  const byId = new Map(run.criteria.map((c) => [c.id, c]));
  const rows: string[][] = [];
  for (const o of run.outcomes) {
    for (const r of o.results) {
      const c = byId.get(r.criterionId);
      rows.push([
        o.caseNo ?? o.id,
        c ? `${c.kind === 'include' ? '納入' : '排除'}：${c.text}` : r.criterionId,
        r.method === 'program' ? '程式判斷' : 'AI 判斷',
        r.verdict === 'met' ? '符合' : r.verdict === 'not_met' ? '不符合' : '無法判斷',
        r.basis,
        r.quotes.join('\n'),
        r.invalidEvidence ? '無效（找不到逐字依據）' : '有效',
      ]);
    }
  }
  return rows;
}
