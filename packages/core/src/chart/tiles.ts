// 量化圖表（issue #8）的「地圖」：示意格狀地圖（每格為一個地方法院，依大致方位排列）。
// 不使用真實地理邊界資料（避免 GeoJSON 授權問題，也不需要離線地圖檔）；圖上標示為示意、非比例地圖。
import { escapeXml } from './svg';

export interface CourtTile {
  /** 比對用關鍵字（依序比對，先命中者優先，例如「士林」須在「臺北」之前）。 */
  key: string;
  label: string;
  col: number;
  row: number;
}

export const COURT_TILES: CourtTile[] = [
  { key: '連江', label: '連江', col: 6, row: 0 },
  { key: '基隆', label: '基隆', col: 3, row: 1 },
  { key: '士林', label: '士林', col: 4, row: 1 },
  { key: '臺北', label: '臺北', col: 3, row: 2 },
  { key: '新北', label: '新北', col: 2, row: 2 },
  { key: '宜蘭', label: '宜蘭', col: 5, row: 2 },
  { key: '桃園', label: '桃園', col: 3, row: 3 },
  { key: '新竹', label: '新竹', col: 3, row: 4 },
  { key: '苗栗', label: '苗栗', col: 3, row: 5 },
  { key: '臺中', label: '臺中', col: 3, row: 6 },
  { key: '南投', label: '南投', col: 4, row: 6 },
  { key: '彰化', label: '彰化', col: 2, row: 7 },
  { key: '雲林', label: '雲林', col: 2, row: 8 },
  { key: '嘉義', label: '嘉義', col: 2, row: 9 },
  { key: '臺南', label: '臺南', col: 1, row: 10 },
  { key: '澎湖', label: '澎湖', col: 0, row: 10 },
  { key: '橋頭', label: '橋頭', col: 1, row: 11 },
  { key: '高雄', label: '高雄', col: 2, row: 11 },
  { key: '屏東', label: '屏東', col: 2, row: 12 },
  { key: '臺東', label: '臺東', col: 3, row: 12 },
  { key: '花蓮', label: '花蓮', col: 4, row: 9 },
  { key: '金門', label: '金門', col: 0, row: 6 },
];

/** 法院名稱（如「臺灣臺北地方法院」）對應的格子；無法對應時回傳 null（不猜）。 */
export function courtTileOf(courtName: string): CourtTile | null {
  const name = courtName.replace(/\s+/g, '');
  if (/高等|最高|智慧財產/.test(name)) return null; // 本圖只畫地方法院
  return COURT_TILES.find((t) => name.includes(t.key)) ?? null;
}

export interface TileValue {
  court: string;
  value: number | null;
  n: number;
}

/** 格狀地圖（SVG）。value 為 0 至 100 的百分比；顏色深淺依值變化，無資料的格子為灰色。 */
export function tileMapSvg(opts: { title: string; subtitle?: string; values: TileValue[]; valueLabel: string; width?: number }): string {
  const width = opts.width ?? 640;
  const cell = 44;
  const gap = 4;
  const left = 24;
  const top = opts.subtitle ? 64 : 44;
  const parts: string[] = [`<text x="16" y="28" font-size="16" font-weight="600" fill="#1f2328">${escapeXml(opts.title)}</text>`];
  if (opts.subtitle) parts.push(`<text x="16" y="48" font-size="11" fill="#57606a">${escapeXml(opts.subtitle)}</text>`);
  const byKey = new Map<string, TileValue>();
  for (const v of opts.values) {
    const tile = courtTileOf(v.court);
    if (tile) byKey.set(tile.key, v);
  }
  const color = (v: number | null) => {
    if (v === null) return '#d0d7de';
    // 序列色盤（淺到深的藍色），0 最淺、100 最深。
    const t = Math.max(0, Math.min(100, v)) / 100;
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
    return `rgb(${mix(222, 0)},${mix(235, 114)},${mix(247, 178)})`;
  };
  for (const tile of COURT_TILES) {
    const x = left + tile.col * (cell + gap);
    const y = top + tile.row * (cell + gap);
    const v = byKey.get(tile.key);
    const val = v?.value ?? null;
    const textColor = val !== null && val > 55 ? '#ffffff' : '#1f2328';
    const tip = v ? `${tile.label}：${val === null ? '無資料' : `${val.toFixed(1)}%`}（${v.n} 件）` : `${tile.label}：無資料`;
    parts.push(`<g><title>${escapeXml(tip)}</title><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="4" fill="${color(val)}"/>`);
    parts.push(`<text x="${x + cell / 2}" y="${y + cell / 2 + 4}" font-size="11" text-anchor="middle" fill="${textColor}">${escapeXml(tile.label)}</text></g>`);
  }
  const rows = 13;
  const height = top + rows * (cell + gap) + 40;
  parts.push(`<text x="16" y="${height - 14}" font-size="11" fill="#57606a">示意格狀地圖（每格一個地方法院，非比例地圖）｜${escapeXml(opts.valueLabel)}：0% 淺色 → 100% 深色；灰色為無資料</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
}
