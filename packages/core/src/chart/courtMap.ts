// 量化圖表（issue #8）的法院與轄區對照：每個地方法院涵蓋哪些縣市，以及是否涵蓋整個縣市。純函式。
// 來源（需正式發布前複核）：英文維基百科 "District court (Taiwan)" 所列轄區描述；臺北市政府法規系統轉載之「各級法院管轄區域一覽表」；
// 法院組織法第 3 條（管轄區域由司法院定之）。查不到的縣市回傳 unknown，不推測。

export type Coverage = 'full' | 'partial';

export interface CountyCoverage {
  county: string;
  /** full：該法院涵蓋整個縣市；partial：只涵蓋縣市的一部分（鄉鎮歸屬未列明）。 */
  coverage: Coverage;
}

export interface CourtJurisdiction {
  /** 正式名稱（與司法院名錄相同）。 */
  court: string;
  counties: CountyCoverage[];
}

export const COURT_JURISDICTIONS: CourtJurisdiction[] = [
  { court: '臺灣臺北地方法院', counties: [{ county: '臺北市', coverage: 'partial' }, { county: '新北市', coverage: 'partial' }] },
  { court: '臺灣士林地方法院', counties: [{ county: '臺北市', coverage: 'partial' }, { county: '新北市', coverage: 'partial' }] },
  { court: '臺灣新北地方法院', counties: [{ county: '新北市', coverage: 'partial' }] },
  { court: '臺灣基隆地方法院', counties: [{ county: '基隆市', coverage: 'full' }, { county: '新北市', coverage: 'partial' }] },
  { court: '臺灣桃園地方法院', counties: [{ county: '桃園市', coverage: 'full' }] },
  { court: '臺灣新竹地方法院', counties: [{ county: '新竹市', coverage: 'full' }, { county: '新竹縣', coverage: 'full' }] },
  { court: '臺灣苗栗地方法院', counties: [{ county: '苗栗縣', coverage: 'full' }] },
  { court: '臺灣臺中地方法院', counties: [{ county: '臺中市', coverage: 'full' }] },
  { court: '臺灣南投地方法院', counties: [{ county: '南投縣', coverage: 'full' }] },
  { court: '臺灣彰化地方法院', counties: [{ county: '彰化縣', coverage: 'full' }] },
  { court: '臺灣雲林地方法院', counties: [{ county: '雲林縣', coverage: 'full' }] },
  { court: '臺灣嘉義地方法院', counties: [{ county: '嘉義市', coverage: 'full' }, { county: '嘉義縣', coverage: 'full' }] },
  { court: '臺灣臺南地方法院', counties: [{ county: '臺南市', coverage: 'full' }] },
  { court: '臺灣高雄地方法院', counties: [{ county: '高雄市', coverage: 'partial' }] },
  { court: '臺灣橋頭地方法院', counties: [{ county: '高雄市', coverage: 'partial' }] },
  { court: '臺灣屏東地方法院', counties: [{ county: '屏東縣', coverage: 'full' }] },
  { court: '臺灣臺東地方法院', counties: [{ county: '臺東縣', coverage: 'full' }] },
  { court: '臺灣花蓮地方法院', counties: [{ county: '花蓮縣', coverage: 'full' }] },
  { court: '臺灣宜蘭地方法院', counties: [{ county: '宜蘭縣', coverage: 'full' }] },
  { court: '臺灣澎湖地方法院', counties: [{ county: '澎湖縣', coverage: 'full' }] },
  { court: '福建金門地方法院', counties: [{ county: '金門縣', coverage: 'full' }] },
  { court: '福建連江地方法院', counties: [{ county: '連江縣', coverage: 'full' }] },
];

/** 比對用的正規化：「台」改為「臺」，去除空白與「臺灣」「福建」前綴。 */
export function normalizeCourtName(name: string): string {
  return name.replace(/台/g, '臺').replace(/\s+/g, '').replace(/^(臺灣|福建)/, '');
}

/** 把資料中的法院名稱對應到正式名稱；找不到（例如高等法院、智慧財產法院）回傳 null。 */
export function canonicalCourt(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = normalizeCourtName(String(name).trim());
  const hit = COURT_JURISDICTIONS.find((c) => normalizeCourtName(c.court) === key);
  return hit ? hit.court : null;
}

export type CountyStatus =
  | { kind: 'court'; court: string }
  | { kind: 'split'; courts: string[] }
  | { kind: 'unknown' };

/**
 * 縣市的著色依據：
 * - 只有一個法院涵蓋且為整縣市 → court（可依該法院的律師代理率著色）；
 * - 有多個法院涵蓋，或只涵蓋一部分 → split（分區管轄，不指定單一法院著色）；
 * - 沒有任何對照 → unknown（標示未知，不猜測）。
 */
export function countyStatus(county: string): CountyStatus {
  const hits = COURT_JURISDICTIONS.filter((c) => c.counties.some((x) => x.county === county));
  if (hits.length === 0) return { kind: 'unknown' };
  if (hits.length === 1) {
    const cov = hits[0].counties.find((x) => x.county === county)!;
    if (cov.coverage === 'full') return { kind: 'court', court: hits[0].court };
  }
  return { kind: 'split', courts: hits.map((h) => h.court) };
}

/** 全部縣市名稱（出現在任一法院的對照中）。 */
export function allCountiesInMap(): string[] {
  return [...new Set(COURT_JURISDICTIONS.flatMap((c) => c.counties.map((x) => x.county)))];
}
