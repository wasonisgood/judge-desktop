# 管轄區模組：共用結構與接入方式

給未來新增國家或超國家組織（例如歐洲人權法院）管轄區的開發者。本版本只實作台灣司法院（`tw-judicial-yuan`），本文件說明已預留的接縫，以及接入新管轄區時要改哪些地方。

## 1. 共用結構

| 層級 | 位置 | 內容 |
|---|---|---|
| 介面與登錄 | `packages/core/src/jurisdiction/registry.ts` | `Jurisdiction` 介面、`JurisdictionRegistry`、預設管轄區 `DEFAULT_JURISDICTION_ID` |
| 範圍整理 | `packages/core/src/court/scope.ts` | `ScopeOptions.jurisdiction`；搜尋與取得內頁都經登錄取得 |
| 桌面端快取 | `apps/desktop/src/main/data/cloud/courtRepo.ts` | `cachedSearch`、`cachedDetail` 的管轄區參數；非預設管轄區的快取鍵加上識別碼 |
| IPC | `apps/desktop/src/main/ipc/*.ts` | `search:run`、`judgment:find`、`brief:run`、`scope:run` 接受 `jurisdiction`；`jurisdictions:list` 列出清單 |
| 設定 | `apps/desktop/src/main/data/local/settingsStore.ts` | `defaultJurisdiction`（預設管轄區） |
| 畫面 | 列表、精讀、範圍整理頁的管轄區選單；設定頁的預設管轄區 | 清單來自 `jurisdictions:list` |

### 介面

```ts
export interface Jurisdiction {
  readonly id: string;              // 例如 'eu-echr'
  readonly name: string;            // 顯示名稱（繁體中文）
  readonly country: string;         // ISO 3166-1 alpha-2；超國家組織可用 'INT'
  readonly supranational?: string;  // 例如 'ECHR'
  readonly statuteLookup: boolean;  // 是否支援法規名稱確認與法條沿革
  search(keyword: string, opts?: JurisdictionSearchOptions): Promise<JudgmentSummary[]>;
  getDetail(id: string, opts?: { client?: unknown }): Promise<JudgmentDetail>;
}
```

- `search` 回傳的 `JudgmentSummary` 與 `getDetail` 回傳的 `JudgmentDetail` 是跨管轄區的共用資料型別（見 `packages/core/src/court/parse.ts`）。
- `client` 是各管轄區自己的工作階段物件（台灣為 `CourtClient`），其他管轄區可以自訂，只要在自己的實作中轉型。

### 註冊

```ts
import { jurisdictionRegistry } from '@judge/core';
jurisdictionRegistry.register(myJurisdiction); // 重複 id 會拋錯
```

登錄後，設定頁的下拉選單、各頁的管轄區選單與 IPC 都會看到它，不需要改 UI 程式碼。

## 2. 新管轄區接入的步驟

1. **實作 `Jurisdiction`**：在 `packages/core/src/<管轄區>/` 下實作 `search` 與 `getDetail`，回傳共用型別。`statuteLookup` 設為 `false`，除非有與台灣法規資料庫相當的法條來源。
2. **在進入點註冊**：於 `packages/core/src/index.ts` 匯出，並在 `jurisdictionRegistry` 登錄（參照 `registry.ts` 末尾的台灣註冊方式）。
3. **確認快取鍵**：非預設管轄區的快取鍵已自動加上識別碼；若新管轄區的判決 id 與台灣格式相同，也不會衝突。
4. **測試**：比照 `packages/core/test/unit/jurisdiction.test.mjs`，用假的 `search`、`getDetail` 驗證範圍整理可以改用新管轄區，且不連網。
5. **不要改動**：UI 與 IPC 不需要修改，管轄區選單會自動出現。

## 3. 目前仍是台灣專用的部分

接入新管轄區前，下列位置需要依管轄區分支（目前都只在預設管轄區下有效）：

- **判決查找的縮寫展開**：`packages/core/src/court/aliases.ts` 的 `judgmentQueries`。`searchIpc.ts` 只在預設管轄區呼叫它。
- **法規名稱確認與法條沿革**：`apps/desktop/src/main/data/cloud/lawRepo.ts`（立法院、全國法規資料庫）。`scopeService.ts` 只在 `statuteLookup` 為 `true` 時呼叫。
- **引用條文的判讀**：`packages/core/src/court/scope.ts` 的 `articlesCiting` 與 `citingExcerpt` 使用台灣的「第 N 條」格式。
- **AI 提示詞**：`packages/core/src/ai/analysis.ts` 的提示詞以台灣的判決結構（主文、事實、理由）撰寫，新管轄區若結構不同，需要另外的提示詞模板。
- **匯出版面**：Excel 與 Word 的欄位名稱（裁判字號、法院見解等）是台灣判決的欄位。

## 4. 不做的事

- **模組不獨立下載**：管轄區模組與其他模組一樣，隨應用程式版本一起發布與更新。沒有獨立的管轄區目錄或更新通道。
- **模組更新採增量同步**：應用程式啟動時比對內建檔案的雜湊，只複製有變動的檔案（`packages/core/src/modules/bundleSync.ts`）。
