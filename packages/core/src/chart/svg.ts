// 量化圖表（issue #8）的繪圖：以純字串產生 SVG（不依賴外部圖表函式庫，避免授權與離線打包問題）。
// 色盤採色盲友善的 Okabe–Ito 系列；所有文字都經過 XML 跳脫。
import { boxStats, violinShape } from './stats';
import type { Crosstab } from './data';

export const PALETTE = ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#F0E442', '#666666'] as const;

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function header(width: number, title: string, subtitle: string): { parts: string[]; top: number } {
  const parts = [
    `<text x="16" y="28" font-size="16" font-weight="600" fill="#1f2328">${escapeXml(title)}</text>`,
  ];
  if (subtitle) parts.push(`<text x="16" y="48" font-size="11" fill="#57606a">${escapeXml(subtitle)}</text>`);
  return { parts, top: subtitle ? 64 : 44 };
}

function wrapSvg(width: number, height: number, body: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"><rect width="100%" height="100%" fill="#ffffff"/>${body.join('')}</svg>`;
}

export interface BarItem {
  label: string;
  value: number;
}

/** 水平長條圖（案由分布、案件分類 × 法院別等）。標籤較長，故採水平排列。 */
export function barChartSvg(opts: { title: string; subtitle?: string; items: BarItem[]; unitLabel: string; width?: number }): string {
  const width = opts.width ?? 720;
  const labelW = 220;
  const rowH = 24;
  const { parts, top } = header(width, opts.title, opts.subtitle ?? '');
  const max = Math.max(1, ...opts.items.map((i) => i.value));
  const plotW = width - labelW - 80;
  opts.items.forEach((it, i) => {
    const y = top + i * rowH;
    const w = (it.value / max) * plotW;
    parts.push(`<text x="${labelW - 8}" y="${y + 16}" font-size="12" text-anchor="end" fill="#1f2328">${escapeXml(it.label)}</text>`);
    parts.push(`<rect x="${labelW}" y="${y + 4}" width="${w.toFixed(1)}" height="${rowH - 8}" fill="${PALETTE[0]}"/>`);
    parts.push(`<text x="${(labelW + w + 6).toFixed(1)}" y="${y + 16}" font-size="12" fill="#1f2328">${it.value}</text>`);
  });
  const height = top + opts.items.length * rowH + 36;
  parts.push(`<text x="16" y="${height - 12}" font-size="11" fill="#57606a">單位：${escapeXml(opts.unitLabel)}</text>`);
  return wrapSvg(width, height, parts);
}

export interface StackSeries {
  name: string;
  values: number[];
}

/** 堆疊條圖（水平）。percent 為 true 時每列正規化為 100%（例如律師代理 × 終結情形的占比）。 */
export function stackedBarSvg(opts: { title: string; subtitle?: string; categories: string[]; series: StackSeries[]; percent: boolean; unitLabel: string; width?: number }): string {
  const width = opts.width ?? 720;
  const labelW = 200;
  const rowH = 34;
  const { parts, top } = header(width, opts.title, opts.subtitle ?? '');
  const legendY = top - 12;
  opts.series.forEach((s, i) => {
    const x = labelW + i * 150;
    parts.push(`<rect x="${x}" y="${legendY}" width="12" height="12" fill="${PALETTE[i % PALETTE.length]}"/>`);
    parts.push(`<text x="${x + 18}" y="${legendY + 11}" font-size="12" fill="#1f2328">${escapeXml(s.name)}</text>`);
  });
  const plotW = width - labelW - 40;
  opts.categories.forEach((cat, ci) => {
    const y = top + 16 + ci * rowH;
    const totals = opts.series.map((s) => s.values[ci] ?? 0);
    const sum = totals.reduce((a, b) => a + b, 0);
    const denom = opts.percent ? (sum || 1) : (Math.max(1, ...opts.categories.map((_, k) => opts.series.reduce((a, s) => a + (s.values[k] ?? 0), 0))));
    let x = labelW;
    parts.push(`<text x="${labelW - 8}" y="${y + 16}" font-size="12" text-anchor="end" fill="#1f2328">${escapeXml(cat)}</text>`);
    opts.series.forEach((s, si) => {
      const v = s.values[ci] ?? 0;
      const w = (v / denom) * plotW;
      if (w > 0) {
        parts.push(`<rect x="${x.toFixed(1)}" y="${y + 4}" width="${w.toFixed(1)}" height="${rowH - 10}" fill="${PALETTE[si % PALETTE.length]}"><title>${escapeXml(`${cat} ／ ${s.name}：${v}${opts.percent ? `（${sum ? ((v / sum) * 100).toFixed(1) : '0.0'}%）` : ''}`)}</title></rect>`);
        if (w > 36) {
          const label = opts.percent ? `${sum ? ((v / sum) * 100).toFixed(0) : 0}%` : String(v);
          parts.push(`<text x="${(x + w / 2).toFixed(1)}" y="${y + 19}" font-size="11" text-anchor="middle" fill="#ffffff">${label}</text>`);
        }
      }
      x += w;
    });
  });
  const height = top + 16 + opts.categories.length * rowH + 36;
  parts.push(`<text x="16" y="${height - 12}" font-size="11" fill="#57606a">單位：${escapeXml(opts.unitLabel)}${opts.percent ? '（每列 100%）' : ''}</text>`);
  return wrapSvg(width, height, parts);
}

export interface ViolinGroup {
  label: string;
  values: number[];
}

/** 小提琴圖（刑期分布，依罪名分組）：寬度為數值附近的案件密度，內含箱形圖與離群值。 */
export function violinSvg(opts: { title: string; subtitle?: string; groups: ViolinGroup[]; yLabel: string; unitLabel: string; width?: number; height?: number }): string {
  const width = opts.width ?? 760;
  const plotH = opts.height ?? 360;
  const groups = opts.groups.filter((g) => g.values.some((v) => Number.isFinite(v)));
  const { parts, top } = header(width, opts.title, opts.subtitle ?? '');
  const left = 64;
  const plotW = width - left - 24;
  const all = groups.flatMap((g) => g.values.filter((v) => Number.isFinite(v)));
  if (!all.length) {
    parts.push(`<text x="16" y="${top + 20}" font-size="13" fill="#57606a">沒有可繪製的數值資料</text>`);
    return wrapSvg(width, top + 60, parts);
  }
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const yOf = (v: number) => top + plotH - ((v - lo) / span) * plotH;
  // 座標軸與刻度（5 等分）
  for (let k = 0; k <= 4; k++) {
    const v = lo + (span * k) / 4;
    const y = yOf(v);
    parts.push(`<line x1="${left}" x2="${width - 24}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#d0d7de" stroke-width="1"/>`);
    parts.push(`<text x="${left - 6}" y="${(y + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#57606a">${Math.round(v)}</text>`);
  }
  parts.push(`<text x="${left - 6}" y="${top - 6}" font-size="11" text-anchor="end" fill="#57606a">${escapeXml(opts.yLabel)}</text>`);
  const slot = plotW / Math.max(1, groups.length);
  groups.forEach((g, i) => {
    const cx = left + slot * (i + 0.5);
    const shape = violinShape(g.values.filter((v) => Number.isFinite(v)));
    const halfMax = Math.min(slot * 0.42, 60);
    const pts: string[] = [];
    shape.ys.forEach((y, k) => pts.push(`${(cx + shape.density[k] * halfMax).toFixed(1)},${yOf(y).toFixed(1)}`));
    for (let k = shape.ys.length - 1; k >= 0; k--) pts.push(`${(cx - shape.density[k] * halfMax).toFixed(1)},${yOf(shape.ys[k]).toFixed(1)}`);
    parts.push(`<polygon points="${pts.join(' ')}" fill="${PALETTE[i % PALETTE.length]}" fill-opacity="0.35" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="1"/>`);
    const bs = boxStats(g.values);
    parts.push(`<line x1="${cx}" x2="${cx}" y1="${yOf(bs.whiskerLow).toFixed(1)}" y2="${yOf(bs.whiskerHigh).toFixed(1)}" stroke="#1f2328" stroke-width="1"/>`);
    parts.push(`<rect x="${(cx - 6).toFixed(1)}" y="${yOf(bs.q3).toFixed(1)}" width="12" height="${Math.max(1, yOf(bs.q1) - yOf(bs.q3)).toFixed(1)}" fill="#ffffff" stroke="#1f2328"/>`);
    parts.push(`<line x1="${(cx - 6).toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y1="${yOf(bs.median).toFixed(1)}" y2="${yOf(bs.median).toFixed(1)}" stroke="#1f2328" stroke-width="2"/>`);
    bs.outliers.forEach((o) => parts.push(`<circle cx="${cx.toFixed(1)}" cy="${yOf(o).toFixed(1)}" r="2.5" fill="none" stroke="#1f2328"/>`));
    parts.push(`<text x="${cx.toFixed(1)}" y="${top + plotH + 16}" font-size="12" text-anchor="middle" fill="#1f2328">${escapeXml(g.label)}（n=${bs.n}，中位數 ${Math.round(bs.median)}）</text>`);
  });
  const height = top + plotH + 60;
  parts.push(`<text x="16" y="${height - 12}" font-size="11" fill="#57606a">單位：${escapeXml(opts.unitLabel)}｜箱形：Q1–Q3，黑線為中位數，圓圈為離群值（Tukey 1.5 IQR）</text>`);
  return wrapSvg(width, height, parts);
}

/** 交叉表的 HTML 表格（列 × 行，含合計）；可選擇顯示每列的百分比。 */
export function crosstabHtml(ct: Crosstab, opts: { rowTitle: string; colTitle: string; percentByRow?: boolean }): string {
  const esc = escapeXml;
  const head = `<tr><th>${esc(opts.rowTitle)} ＼ ${esc(opts.colTitle)}</th>${ct.colLabels.map((c) => `<th>${esc(c)}</th>`).join('')}<th>合計</th></tr>`;
  const body = ct.rowLabels.map((r, i) => {
    const cells = ct.cells[i].map((v) => {
      if (!opts.percentByRow) return `<td>${v}</td>`;
      const pct = ct.rowTotals[i] ? ((v / ct.rowTotals[i]) * 100).toFixed(1) : '0.0';
      return `<td>${v}（${pct}%）</td>`;
    });
    return `<tr><th>${esc(r)}</th>${cells.join('')}<td><strong>${ct.rowTotals[i]}</strong></td></tr>`;
  });
  const foot = `<tr><th>合計</th>${ct.colTotals.map((v) => `<td><strong>${v}</strong></td>`).join('')}<td><strong>${ct.total}</strong></td></tr>`;
  return `<table class="crosstab"><thead>${head}</thead><tbody>${body.join('')}${foot}</tbody></table>`;
}
