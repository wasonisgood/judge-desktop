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
