// 法院管轄區（jurisdiction）的接縫（seam）。
// 目前只有台灣司法院一個實作；未來要支援其他國家或超國家組織（例如歐洲人權法院、國際刑事法院）時，
// 只需實作 Jurisdiction 介面並註冊到 jurisdictionRegistry，不必改動範圍整理、匯出或 AI 分析的呼叫端。
//
// 設計原則：
// - 呼叫端只透過 jurisdiction id 取得管轄區，未指定時使用 DEFAULT_JURISDICTION_ID（台灣），因此既有行為不變。
// - 管轄區的資料來源與版本與本地模組目錄（catalog）無關；目錄更新不必與雲端、本地同步。
import { CourtClient } from '../court/client';
import { searchJudgments, getJudgmentDetail } from '../court/search';
import type { JudgmentDetail, JudgmentSummary } from '../court/parse';

/** 管轄區識別碼，例如 'tw-judicial-yuan'、'eu-echr'。 */
export type JurisdictionId = string;

export interface JurisdictionSearchOptions {
  maxItems?: number;
  /**
   * 此管轄區的工作階段（session）。台灣司法院使用有狀態的 CourtClient；
   * 其他管轄區可自行定義，並在自己的實作中轉型。
   */
  client?: unknown;
}

export interface Jurisdiction {
  readonly id: JurisdictionId;
  /** 顯示名稱（繁體中文）。 */
  readonly name: string;
  /** 所屬國家（ISO 3166-1 alpha-2）；超國家組織可使用 'INT' 或其慣用代碼。 */
  readonly country: string;
  /** 所屬超國家組織（例如 'ECHR'、'ICC'），沒有則省略。 */
  readonly supranational?: string;
  /**
   * 是否支援法規名稱確認與法條沿革（台灣的法規資料庫）。
   * 不支援時，範圍整理只能以關鍵字搜尋，不做法條比對。
   */
  readonly statuteLookup: boolean;
  search(keyword: string, opts?: JurisdictionSearchOptions): Promise<JudgmentSummary[]>;
  getDetail(id: string, opts?: { client?: unknown }): Promise<JudgmentDetail>;
}

export const DEFAULT_JURISDICTION_ID: JurisdictionId = 'tw-judicial-yuan';

/** 台灣司法院裁判書查詢系統。 */
export const taiwanJudicialYuan: Jurisdiction = {
  id: DEFAULT_JURISDICTION_ID,
  name: '司法院裁判書查詢系統',
  country: 'TW',
  statuteLookup: true,
  async search(keyword, opts = {}) {
    const client = (opts.client as CourtClient | undefined) ?? new CourtClient();
    return searchJudgments(keyword, { maxItems: opts.maxItems, client });
  },
  async getDetail(id, opts = {}) {
    const client = (opts.client as CourtClient | undefined) ?? new CourtClient();
    return getJudgmentDetail(id, client);
  },
};

export class JurisdictionRegistry {
  private readonly items = new Map<JurisdictionId, Jurisdiction>();

  private readonly defaultId: JurisdictionId;

  constructor(defaultId: JurisdictionId = DEFAULT_JURISDICTION_ID) {
    this.defaultId = defaultId;
  }

  /** 註冊管轄區；重複 id 會拋錯，避免靜默覆寫。 */
  register(j: Jurisdiction): void {
    if (!j.id) throw new Error('管轄區缺少 id');
    if (this.items.has(j.id)) throw new Error(`管轄區重複註冊：${j.id}`);
    this.items.set(j.id, j);
  }

  has(id: JurisdictionId): boolean {
    return this.items.has(id);
  }

  /** 取得管轄區；未指定 id 時回傳預設管轄區；找不到則拋錯（不默默改用其他管轄區）。 */
  get(id?: JurisdictionId): Jurisdiction {
    const key = id ?? this.defaultId;
    const j = this.items.get(key);
    if (!j) throw new Error(`未知的管轄區：${key}`);
    return j;
  }

  list(): Jurisdiction[] {
    return [...this.items.values()];
  }

  get defaultJurisdictionId(): JurisdictionId {
    return this.defaultId;
  }
}

export const jurisdictionRegistry = new JurisdictionRegistry();
jurisdictionRegistry.register(taiwanJudicialYuan);

