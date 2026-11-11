// 結果自動出圖（純函式，不依賴 Electron）：把判決列表、標編碼結果轉成圖表模組的資料，沿用同一套畫圖程式。
// 只使用結果中已有的欄位（字號、法院、日期、案由、字號類型），不連線、不呼叫 AI。
import { buildChartResult, sanitizeChartConfig, type ChartSheet, type ChartResult, type ChartType } from './chartData';

export interface ResultRow {
  id: string;
  title: string;
  court: string;
  dateIso: string | null;
  cause: string;
  caseType: string;
}

const MAX_ROWS = 2000;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** 清理畫面送來的結果列（字串長度與筆數上限）。 */
export function sanitizeResultRows(raw: unknown): ResultRow[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ResultRow[] = [];
  for (const item of raw.slice(0, MAX_ROWS)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const dateIso = str(r.dateIso, 20);
    out.push({
      id,
      title: str(r.title, 200),
      court: str(r.court, 80),
      dateIso: dateIso || null,
      cause: str(r.cause, 80),
      caseType: str(r.caseType, 20),
    });
  }
  return out;
}

/** 從字號標題推出法院（「臺灣臺北地方法院 115 年度…」→「臺灣臺北地方法院」）；推不出時回傳空字串。 */
export function courtOf(title: string): string {
  const m = /^(.+?)\s*\d+\s*年度/.exec(title);
  return m ? m[1].trim() : '';
}

export function yearOf(dateIso: string | null): string {
  return dateIso && /^\d{4}/.test(dateIso) ? dateIso.slice(0, 4) : '未知';
}

export const RESULT_HEADERS = ['判決ID', '字號', '法院', '年份', '案由', '字號類型'];

export function resultSheet(rows: ResultRow[]): ChartSheet {
  return {
    name: '結果',
    headers: RESULT_HEADERS,
    rows: rows.map((r) => ({
      '判決ID': r.id,
      '字號': r.title,
      '法院': r.court || courtOf(r.title) || '未知',
      '年份': yearOf(r.dateIso),
      '案由': r.cause || '未填',
      '字號類型': r.caseType || '未分類',
    })),
  };
}

export interface ChartSpec {
  title: string;
  type: ChartType;
  category: string;
  series?: string;
}

/** 固定的預設圖表：案由、法院、年份是各類結果都有的；有字號類型時加上年份分段圖。 */
export function chartSpecs(hasCaseType: boolean): ChartSpec[] {
  const specs: ChartSpec[] = [
    { title: '案由分布', type: 'bar', category: '案由' },
    { title: '法院分布', type: 'bar', category: '法院' },
    { title: '裁判年份', type: 'bar', category: '年份' },
  ];
  if (hasCaseType) specs.push({ title: '年份與字號類型', type: 'stacked', category: '年份', series: '字號類型' });
  return specs;
}

export function buildResultCharts(rows: ResultRow[]): { charts: ChartResult[]; warnings: string[] } {
  if (rows.length === 0) return { charts: [], warnings: ['沒有可出圖的判決'] };
  const sheet = resultSheet(rows);
  const inferredKinds = Object.fromEntries(RESULT_HEADERS.map((h) => [h, 'category' as const]));
  const hasCaseType = rows.some((r) => r.caseType);
  const charts: ChartResult[] = [];
  const warnings: string[] = [];
  for (const spec of chartSpecs(hasCaseType)) {
    try {
      const config = sanitizeChartConfig({
        type: spec.type, unit: 'judgments', title: spec.title, idColumn: '判決ID',
        category: spec.category, series: spec.series ?? null,
      });
      charts.push(buildChartResult({ sheet, fileName: '結果', config, inferredKinds }));
    } catch (err) {
      warnings.push(`${spec.title}：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { charts, warnings };
}

// ---------------------------------------------------------------------------
// 納入排除的執行紀錄出圖：每案的決定，以及每條標準的判定分布
// ---------------------------------------------------------------------------

export interface RunOutcome {
  id: string;
  decision: string;
  dateIso: string | null;
  /** 每條標準的名稱與判定（依標準順序）。 */
  verdicts: { name: string; verdict: string }[];
}

const DECISION_LABEL: Record<string, string> = { include: '納入', exclude: '排除', review: '需人工檢視' };
const VERDICT_LABEL: Record<string, string> = { met: '符合', not_met: '不符合', unknown: '無法判斷' };
const MAX_CRITERIA_CHARTS = 8;

/** 清理執行紀錄（只保留可出圖的欄位，限制筆數與長度）。 */
export function sanitizeRunOutcomes(raw: unknown): RunOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: RunOutcome[] = [];
  for (const item of raw.slice(0, MAX_ROWS)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = str(o.id, 200);
    if (!id) continue;
    const verdicts: RunOutcome['verdicts'] = [];
    if (Array.isArray(o.verdicts)) {
      for (const v of o.verdicts.slice(0, MAX_CRITERIA_CHARTS)) {
        if (!v || typeof v !== 'object') continue;
        const x = v as Record<string, unknown>;
        verdicts.push({ name: str(x.name, 40) || '標準', verdict: str(x.verdict, 20) });
      }
    }
    const dateIso = str(o.dateIso, 20);
    out.push({ id, decision: str(o.decision, 20), dateIso: dateIso || null, verdicts });
  }
  return out;
}

/** 執行紀錄的圖表：決定分布一張；每條標準的判定分布各一張。 */
export function buildRunCharts(outcomes: RunOutcome[]): { charts: ChartResult[]; warnings: string[] } {
  if (outcomes.length === 0) return { charts: [], warnings: ['本次沒有可出圖的結果'] };
  const criteriaCount = Math.max(0, ...outcomes.map((o) => o.verdicts.length));
  const colOf = (k: number) => `準則${k + 1}`;
  const headers = ['判決ID', '決定', '年份', ...Array.from({ length: criteriaCount }, (_, k) => colOf(k))];
  const sheet: ChartSheet = {
    name: '執行結果',
    headers,
    rows: outcomes.map((o) => {
      const row: Record<string, string> = {
        '判決ID': o.id,
        '決定': DECISION_LABEL[o.decision] ?? (o.decision || '未知'),
        '年份': yearOf(o.dateIso),
      };
      for (let k = 0; k < criteriaCount; k++) {
        const v = o.verdicts[k];
        row[colOf(k)] = v ? VERDICT_LABEL[v.verdict] ?? '無法判斷' : '未判定';
      }
      return row;
    }),
  };
  const inferredKinds = Object.fromEntries(headers.map((h) => [h, 'category' as const]));
  const specs: { title: string; category: string }[] = [{ title: '納入排除結果分布', category: '決定' }];
  for (let k = 0; k < criteriaCount; k++) {
    const name = outcomes.find((o) => o.verdicts[k])?.verdicts[k]?.name ?? '';
    specs.push({ title: `標準 ${k + 1}：${name}`.slice(0, 60), category: colOf(k) });
  }
  const charts: ChartResult[] = [];
  const warnings: string[] = [];
  for (const spec of specs) {
    try {
      const config = sanitizeChartConfig({ type: 'bar', unit: 'judgments', title: spec.title, idColumn: '判決ID', category: spec.category, series: null });
      charts.push(buildChartResult({ sheet, fileName: '執行結果', config, inferredKinds }));
    } catch (err) {
      warnings.push(`${spec.title}：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { charts, warnings };
}
