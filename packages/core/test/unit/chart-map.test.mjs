// 量化圖表地圖：法院與轄區對照的邊界案例（分區、整縣市、未知）與縣市地圖 SVG 結構。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COURT_JURISDICTIONS, canonicalCourt, countyStatus, allCountiesInMap, countyMapSvg,
} from '../../dist/index.js';

test('對照表：法院名稱不重複，每個法院至少涵蓋一個縣市', () => {
  const names = COURT_JURISDICTIONS.map((c) => c.court);
  assert.equal(new Set(names).size, names.length);
  for (const c of COURT_JURISDICTIONS) assert.ok(c.counties.length > 0, c.court);
});

test('canonicalCourt：「台」與「臺」、有無「臺灣」前綴、空白都對應到同一正式名稱', () => {
  assert.equal(canonicalCourt('臺灣臺北地方法院'), '臺灣臺北地方法院');
  assert.equal(canonicalCourt('臺北地方法院'), '臺灣臺北地方法院');
  assert.equal(canonicalCourt('台北地方法院'), '臺灣臺北地方法院');
  assert.equal(canonicalCourt(' 臺灣 桃園地方法院 '), '臺灣桃園地方法院');
  assert.equal(canonicalCourt('福建金門地方法院'), '福建金門地方法院');
  assert.equal(canonicalCourt('金門地方法院'), '福建金門地方法院');
});

test('canonicalCourt：不在對照表的法院（高等法院、智慧財產法院）、空白與 null 回傳 null，不猜測', () => {
  assert.equal(canonicalCourt('智慧財產法院'), null);
  assert.equal(canonicalCourt('臺灣高等法院'), null);
  assert.equal(canonicalCourt(''), null);
  assert.equal(canonicalCourt(null), null);
  assert.equal(canonicalCourt(undefined), null);
});

test('countyStatus：整縣市由單一法院涵蓋 → court', () => {
  assert.deepEqual(countyStatus('桃園市'), { kind: 'court', court: '臺灣桃園地方法院' });
  assert.deepEqual(countyStatus('基隆市'), { kind: 'court', court: '臺灣基隆地方法院' });
  assert.deepEqual(countyStatus('金門縣'), { kind: 'court', court: '福建金門地方法院' });
  assert.deepEqual(countyStatus('嘉義縣'), { kind: 'court', court: '臺灣嘉義地方法院' });
});

test('countyStatus：多個法院分區（臺北市、新北市、高雄市）→ split，列出所有法院，不指定單一著色', () => {
  const tp = countyStatus('臺北市');
  assert.equal(tp.kind, 'split');
  assert.deepEqual(tp.courts, ['臺灣臺北地方法院', '臺灣士林地方法院']);
  const ntp = countyStatus('新北市');
  assert.equal(ntp.kind, 'split');
  assert.equal(ntp.courts.length, 4);
  assert.equal(countyStatus('高雄市').kind, 'split');
});

test('countyStatus：只涵蓋一部分的縣市即使只有一個法院也是 split（不當成整縣市）', () => {
  // 新北市目前只有 partial 涵蓋；單一法院的 partial 不得著色為整縣市。
  const only = COURT_JURISDICTIONS.filter((c) => c.counties.some((x) => x.county === '新北市' && x.coverage === 'partial'));
  assert.ok(only.length >= 1);
  assert.equal(countyStatus('新北市').kind, 'split');
});

test('countyStatus：對照表以外的縣市 → unknown（標示未知，不猜）', () => {
  assert.deepEqual(countyStatus('臺北縣'), { kind: 'unknown' });
  assert.deepEqual(countyStatus(''), { kind: 'unknown' });
});

test('allCountiesInMap：涵蓋 22 個縣市（直轄市、縣、市，含金門與連江）', () => {
  const all = allCountiesInMap();
  assert.equal(all.length, 22);
  for (const c of ['金門縣', '連江縣', '澎湖縣', '臺東縣']) assert.ok(all.includes(c), c);
});

// 測試用的簡單方形界線（座標系 0..100）。
function fakeGeo(names) {
  return {
    viewBox: [0, 0, 100, 100],
    attribution: '© OpenStreetMap contributors',
    counties: names.map((name, i) => ({
      name, d: `M${i} 0L${i + 5} 0L${i + 5} 5Z`, cx: i + 2, cy: 2,
    })),
  };
}

test('縣市地圖 SVG：根元素的寬高為整數（PNG 匯出依此讀取尺寸）', () => {
  const geo = fakeGeo(allCountiesInMap());
  const { svg } = countyMapSvg({ title: 't', geo, valueLabel: 'v', courts: [] });
  assert.match(svg, /^<svg[^>]* width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/);
});

test('縣市地圖 SVG：整縣市依法院律師代理率著色；無資料為灰色', () => {
  const geo = fakeGeo(allCountiesInMap());
  const { svg } = countyMapSvg({
    title: '各地方法院律師代理率', geo, valueLabel: '律師代理率',
    courts: [
      { court: '臺灣桃園地方法院', value: 50, n: 10 },
      { court: '臺灣臺中地方法院', value: null, n: 0 },
    ],
  });
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /data-county="桃園市" data-status="court"/);
  assert.ok(svg.includes('fill="rgb(111,175,213)"'), '50% 應為中間色階');
  assert.match(svg, /data-county="臺中市" data-status="court"[\s\S]*?fill="#d0d7de"/);
});

test('縣市地圖 SVG：分區管轄以斜線圖案標示且列入結果；未知縣市列入結果', () => {
  const geo = fakeGeo(allCountiesInMap());
  const res = countyMapSvg({ title: 't', geo, valueLabel: 'v', courts: [] });
  assert.ok(res.split.includes('臺北市') && res.split.includes('新北市') && res.split.includes('高雄市'));
  assert.match(res.svg, /data-county="臺北市" data-status="split"[\s\S]*?url\(#split-hatch\)/);
  assert.ok(res.svg.includes('<pattern id="split-hatch"'));
  assert.deepEqual(res.unknown, []);
  // 幾何資料缺少的縣市視為未知，不可靜默略過。
  const partial = countyMapSvg({ title: 't', geo: fakeGeo(['桃園市']), valueLabel: 'v', courts: [] });
  assert.ok(partial.unknown.includes('臺中市'));
});

test('縣市地圖 SVG：標示 OSM 授權與資料來源，標題經 XML 跳脫', () => {
  const geo = fakeGeo(allCountiesInMap());
  const { svg } = countyMapSvg({ title: '<script>x</script>', geo, valueLabel: 'v', courts: [] });
  assert.ok(svg.includes('© OpenStreetMap contributors（ODbL 1.0）'));
  assert.ok(!svg.includes('<script>'), '標題必須跳脫');
  assert.ok(svg.includes('&lt;script&gt;'));
});

test('縣市地圖 SVG：圖例列出每個法院的律師代理率與件數', () => {
  const geo = fakeGeo(allCountiesInMap());
  const { svg } = countyMapSvg({
    title: 't', geo, valueLabel: '律師代理率',
    courts: [{ court: '臺灣桃園地方法院', value: 33.333, n: 3 }],
  });
  assert.ok(svg.includes('臺灣桃園地方法院：33.3%（3 件）'));
});
