// 量化圖表（issue #8）的統計函式：分位數、箱形圖統計、核密度（小提琴圖的寬度）。純函式。

/** 線性內插分位數（與 R 的 type 7 相同）。values 必須已排序且非空。 */
export function quantileSorted(sorted: number[], p: number): number {
  if (!sorted.length) throw new Error('分位數需要至少一個數值');
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[sorted.length - 1];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function median(values: number[]): number {
  return quantileSorted([...values].sort((a, b) => a - b), 0.5);
}

export interface BoxStats {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Tukey 圍籬：Q1 − 1.5 IQR 與 Q3 + 1.5 IQR 之內的最小、最大值為鬚的端點。 */
  whiskerLow: number;
  whiskerHigh: number;
  /** 超出圍籬的離群值（由小到大）。 */
  outliers: number[];
}

/** 箱形圖統計（僅用有限數值）。沒有數值時拋錯，呼叫端應先過濾。 */
export function boxStats(values: number[]): BoxStats {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) throw new Error('箱形圖統計需要至少一個數值');
  const q1 = quantileSorted(v, 0.25);
  const q3 = quantileSorted(v, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inside = v.filter((x) => x >= lowFence && x <= highFence);
  return {
    n: v.length,
    min: v[0],
    q1,
    median: quantileSorted(v, 0.5),
    q3,
    max: v[v.length - 1],
    whiskerLow: inside.length ? inside[0] : v[0],
    whiskerHigh: inside.length ? inside[inside.length - 1] : v[v.length - 1],
    outliers: v.filter((x) => x < lowFence || x > highFence),
  };
}

/** Silverman 經驗法則的頻寬；標準差為 0 時退回為 1（避免除以零）。 */
export function silvermanBandwidth(values: number[]): number {
  const n = values.length;
  const mean = values.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  const sorted = [...values].sort((a, b) => a - b);
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const spread = Math.min(sd, iqr / 1.34 || sd);
  const s = spread > 0 ? spread : sd > 0 ? sd : 1;
  return 0.9 * s * Math.pow(n, -0.2);
}

export interface ViolinShape {
  /** 等距的 y 座標（數值軸）。 */
  ys: number[];
  /** 對應 ys 的密度，已正規化為最大值 1（畫面上的寬度比例）。 */
  density: number[];
  bandwidth: number;
}

/**
 * 高斯核密度估計，供小提琴圖使用。範圍向兩側各延伸 3 個頻寬，
 * 因此尾端會趨近於 0（不會在資料最小值處被截斷）。
 */
export function violinShape(values: number[], gridSize = 60): ViolinShape {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) throw new Error('小提琴圖需要至少一個數值');
  const bw = silvermanBandwidth(v);
  const lo = Math.min(...v) - 3 * bw;
  const hi = Math.max(...v) + 3 * bw;
  const ys: number[] = [];
  const raw: number[] = [];
  for (let i = 0; i < gridSize; i++) {
    const y = lo + ((hi - lo) * i) / (gridSize - 1);
    ys.push(y);
    let s = 0;
    for (const x of v) {
      const z = (y - x) / bw;
      s += Math.exp(-0.5 * z * z);
    }
    raw.push(s / (v.length * bw * Math.sqrt(2 * Math.PI)));
  }
  const max = Math.max(...raw) || 1;
  return { ys, density: raw.map((d) => d / max), bandwidth: bw };
}
