// 量化圖表（issue #8）的地圖：縣市界線（OpenStreetMap，ODbL）依各地方法院的律師代理率著色。純字串 SVG。
// 規則：整縣市由單一法院涵蓋者依該法院著色（無資料為灰色）；分區管轄者以斜線標示、不著色；無對照者標示未知。
import { escapeXml } from './svg';
import { countyStatus, allCountiesInMap, type CountyStatus } from './courtMap';

export interface GeoCounty {
  name: string;
  /** SVG path（已投影，座標系同 geo.viewBox）。 */
  d: string;
  cx: number;
  cy: number;
}

export interface GeoData {
  viewBox: [number, number, number, number];
  attribution: string;
  counties: GeoCounty[];
}

export interface MapCourtValue {
  /** 正式法院名稱（見 courtMap）。 */
  court: string;
  /** 律師代理率（0–100）；無資料為 null。 */
  value: number | null;
  /** 計入的件數（依所選單位）。 */
  n: number;
}

export const MAP_ATTRIBUTION = '© OpenStreetMap contributors（ODbL 1.0）';

function rampColor(v: number): string {
  const t = Math.max(0, Math.min(100, v)) / 100;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(222, 0)},${mix(235, 114)},${mix(247, 178)})`;
}

export interface CountyMapResult {
  svg: string;
  /** 分區管轄（未著色）的縣市。 */
  split: string[];
  /** 無對照（未知）的縣市。 */
  unknown: string[];
}

export function countyMapSvg(opts: {
  title: string;
  subtitle?: string;
  geo: GeoData;
  courts: MapCourtValue[];
  valueLabel: string;
  /** 寬度（像素）；地圖依此等比縮放。 */
  width?: number;
}): CountyMapResult {
  const width = opts.width ?? 640;
  const [vx, vy, vw, vh] = opts.geo.viewBox;
  const headerH = opts.subtitle ? 64 : 44;
  const mapW = Math.min(width - 32, 420);
  const scale = mapW / vw;
  const mapH = vh * scale;
  const byCourt = new Map(opts.courts.map((c) => [c.court, c]));
  const geoByName = new Map(opts.geo.counties.map((c) => [c.name, c]));
  const split: string[] = [];
  const unknown: string[] = [];
  const parts: string[] = [
    `<text x="16" y="28" font-size="16" font-weight="600" fill="#1f2328">${escapeXml(opts.title)}</text>`,
  ];
  if (opts.subtitle) parts.push(`<text x="16" y="48" font-size="11" fill="#57606a">${escapeXml(opts.subtitle)}</text>`);
  parts.push(
    '<defs><pattern id="split-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + '<rect width="6" height="6" fill="#f6f8fa"/><line x1="0" y1="0" x2="0" y2="6" stroke="#8c959f" stroke-width="2"/></pattern></defs>',
  );
  parts.push(`<g transform="translate(16 ${headerH}) scale(${scale.toFixed(5)}) translate(${-vx} ${-vy})">`);
  for (const name of allCountiesInMap()) {
    const g = geoByName.get(name);
    const st: CountyStatus = countyStatus(name);
    let fill = '#e5e7eb';
    let tip = `${name}：未知（無對照，不推測）`;
    let status = 'unknown';
    if (st.kind === 'court') {
      const v = byCourt.get(st.court);
      const val = v?.value ?? null;
      fill = val === null ? '#d0d7de' : rampColor(val);
      tip = `${name}（${st.court}）：${val === null ? '無資料' : `${val.toFixed(1)}%（${v?.n ?? 0} 件）`}`;
      status = 'court';
    } else if (st.kind === 'split') {
      fill = 'url(#split-hatch)';
      tip = `${name}：分區管轄（${st.courts.join('、')}），不指定單一法院著色`;
      status = 'split';
    }
    if (status === 'split') split.push(name);
    if (status === 'unknown') unknown.push(name);
    if (!g) {
      unknown.push(name);
      continue;
    }
    const dark = st.kind === 'court' && (byCourt.get(st.court)?.value ?? 0) > 55;
    const tc = dark ? '#ffffff' : '#1f2328';
    parts.push(
      `<g data-county="${escapeXml(name)}" data-status="${status}"><title>${escapeXml(tip)}</title>`
      + `<path d="${g.d}" fill="${fill}" fill-rule="evenodd" stroke="#57606a" stroke-width="${(0.6 / scale).toFixed(3)}"/>`
      + `<text x="${g.cx}" y="${g.cy}" font-size="${(9 / scale).toFixed(2)}" text-anchor="middle" fill="${tc}">${escapeXml(name)}</text></g>`,
    );
  }
  parts.push('</g>');

  // 圖例：各法院的律師代理率（依正式名稱排列）。
  let y = headerH + mapH + 18;
  parts.push(`<text x="16" y="${y}" font-size="12" font-weight="600" fill="#1f2328">${escapeXml(opts.valueLabel)}（依地方法院）</text>`);
  for (const c of opts.courts) {
    y += 18;
    const txt = c.value === null ? '無資料' : `${c.value.toFixed(1)}%（${c.n} 件）`;
    parts.push(`<text x="24" y="${y}" font-size="11" fill="#1f2328">${escapeXml(c.court)}：${escapeXml(txt)}</text>`);
  }
  y += 18;
  const splitTxt = split.length ? `分區管轄未著色：${split.join('、')}` : '';
  const unkTxt = unknown.length ? `未知：${unknown.join('、')}` : '';
  const foot = [splitTxt, unkTxt].filter(Boolean).join('｜');
  if (foot) parts.push(`<text x="24" y="${y}" font-size="11" fill="#57606a">${escapeXml(foot)}</text>`);
  y += 18;
  parts.push(`<text x="16" y="${y}" font-size="10" fill="#57606a">地圖：${escapeXml(MAP_ATTRIBUTION)}；縣市界線為簡化外框，法院轄區依 courtMap 對照（需複核）</text>`);
  const height = Math.ceil(y + 16);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
  return { svg, split, unknown };
}
