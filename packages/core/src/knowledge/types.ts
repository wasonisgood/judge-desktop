// 爭點知識庫（issue #5）：資料結構型別。
// 上層（領域、次領域）由 path 陣列表示；爭點本身一定包含核心描述、區分實益、學說見解、實務見解。
// 本模組只定義純資料結構；讀檔與 I/O 由桌面端負責，核心不接觸檔案系統。

export const KNOWLEDGE_SCHEMA_VERSION = 1;

export interface Doctrine {
  /** 甲說、乙說、丙說…… */
  label: string;
  view: string;
  pros: string;
  cons: string;
}

export interface PracticeView {
  /** 時期或年代區間（例如「早期」「近期」）。 */
  period: string;
  view: string;
  /** 派別或補充說明。 */
  note: string;
}

export interface Issue {
  id: string;
  title: string;
  /** 階層路徑（大領域 → 次領域 → …），上層結構由資料作者自行規劃。 */
  path: string[];
  /** 供模糊搜尋的關鍵詞。 */
  keywords: string[];
  /** 爭點核心描述：一句話命題。 */
  proposition: string;
  /** 爭點區分實益。 */
  distinction: string;
  /** 學說見解（至少兩說）。 */
  doctrines: Doctrine[];
  /** 實務見解（可有派別與前後期）。 */
  practice: PracticeView[];
  lawRefs: string[];
  reviewStatus: string;
}

export interface KnowledgeFile {
  schemaVersion: number;
  jurisdiction: string;
  domain: string;
  issues: Issue[];
}

/** 已通過驗證並帶有法域標記的爭點。 */
export interface IndexedIssue extends Issue {
  jurisdiction: string;
  domain: string;
}

export interface KnowledgeIndex {
  issues: IndexedIssue[];
}
