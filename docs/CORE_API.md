# 核心函數盤點（packages/core）

狀態：草案 v0.1（2026-11-08）。桌面端與遠端 MCP 共用此套件。
標記：**移植**＝來自既有 Python 程式；**新增**＝本專案新設計；**捨棄**＝不再需要。
來源路徑均相對於 `C:\Users\user\code\judge_mcp\fjud_mcp\`。

## 0. 司法院網站的流程（移植的前提）

`crawler.py` 的流程是 ASP.NET WebForms，有狀態、需要依序執行：

1. GET `FJUD/default.aspx` 取得 `__VIEWSTATE`、`__VIEWSTATEGENERATOR`、`__EVENTVALIDATION`。
2. POST 關鍵字查詢（`ctl00$cp_content$btnSimpleQry`），必要時再選擇法院。
3. 解析列表 HTML，取得判決 ID（例：`TPSV_103_2434_20141119`）。
4. 逐筆 GET `data.aspx?ty=JD&id=...&ot=in` 取得全文。
5. 每次請求間隔 0.8 秒（`sleep_sec`），timeout 預設 25 秒。

2026-11-08 實測：台灣區 Cloud Functions 可正常連到此網站（200、19 KB、179 ms），因此雲端執行並非不可行，但我們仍預設在使用者電腦執行（見 SPEC §10）。

---

## 1. 司法院檢索與解析（packages/core/court）

| 函數（建議 TypeScript 簽章） | 來源 | 狀態 | 說明 |
|---|---|---|---|
| `createSession(): CourtSession` | `_get_state` | 移植 | 維護 cookie 與 ViewState，所有查詢共用同一個 session |
| `searchJudgments(q: SearchQuery): Promise<JudgmentSummary[]>` | `_post_keyword`、`_fetch_list_all`、`_fetch_list_by_court` | 移植 | 關鍵字、法院、期間、案由篩選；回傳列表基本欄位 |
| `fetchCourtMenu(q): Promise<CourtOption[]>` | `_fetch_court_menu` | 移植 | 取得可選法院與筆數 |
| `parseListHtml(html): JudgmentSummary[]` | `_parse_list_html` | 移植 | 純函數，可用固定 HTML 做單元測試 |
| `getJudgmentDetail(id): Promise<JudgmentDetail>` | `_parse_detail`、`_extract_fulltext`、`_split_sections` | 移植 | 回傳 metadata、段落（主文／事實／理由）、全文 |
| `splitSections(fullText): Sections` | `_split_sections`、`_sanitize_preface` | 移植 | 純函數 |
| `extractSnippets(text, keyword, opts): Snippet[]` | `_extract_snippets_from_text`、`_from_sections` | 移植 | 含前後文視窗、每篇上限、段落範圍 |
| `searchByCaseNumber(caseNo, max): Promise<JudgmentSummary[]>` | `server.py: search_by_case_number` | 移植 | 案號轉為查詢條件 |
| `getCourtList(): CourtInfo[]` | `server.py: get_court_list` | 移植 | 靜態資料 |
| `throttle` (rate limiter) | `sleep_sec` | 移植 | 全域最小間隔 0.8 秒，所有請求都要經過它 |
| `courtSelectionPolicy` | `_prompt_court_choice` | 改寫 | 原為命令列互動；改為回傳選項，由 UI 或 AI 決定 |
| `dumpHtml` | `_dump_html` | 捨棄 | 除錯用，改為測試夾具（fixture） |

## 2. 文字處理（packages/core/text）

| 函數 | 來源 | 狀態 |
|---|---|---|
| `cleanText(s)`、`stripCjkGaps(s)` | `_clean_text`、`_strip_cjk_gaps` | 移植 |
| `reflowText(raw)`、`shouldJoin`、`looksLikeHeading` | `_reflow_text` 等 | 移植 |
| `sentenceSplitChinese(text)` | `_sentence_split_chinese` | 移植 |
| `isoFromMinguo(s)`、`rocYear(s)`、`periodOf(s)` | `_iso_from_minguo`、`update_excel.roc_year/period_of` | 移植（民國年轉換） |
| `normalizeJudgmentId(s)`、`baseId(id)` | `recovery_pipeline.norm_id`、`update_excel.base_id` | 移植 |
| `cleanPuas(s)`、`cleanSp(s)` | `recovery_pipeline.clean_puas/clean_sp` | 移植（清除異常字元） |

## 3. 分類與統計（packages/core/classify）

| 函數 | 來源 | 狀態 | 說明 |
|---|---|---|---|
| `docTypeOf(title)` | `update_excel.doc_type` | 移植 | 判決／裁定等類型 |
| `courtOf(title)` | `update_excel.court_of` | 移植 | |
| `resultOf(mainText)` | `update_excel.result_of` | 移植 | 駁回、撤銷發回等結果 |
| `pickFields(record, keys)` | `export_word.pick` | 移植 | |
| `groupBy(records, key, order?)` | `export_word.group_by` | 移植 | |
| `buildStats(records, dims)` | `rebuild_pos_stat`、`rebuild_neg_stat`、`rebuild_decade_stat` | 移植，改為通用維度 | 原本只做條文固定的統計；改為使用者選擇的維度 |

## 4. 列表與 Excel（packages/core/excel）

| 函數 | 來源 | 狀態 | 說明 |
|---|---|---|---|
| `readMainRows(ws)`、`readRecords(ws, keyCol)` | `update_excel.read_main_rows`、`export_word.read_records` | 移植 | 讀取既有 Excel |
| `buildMainRow(detail, columns)` | `update_excel.build_main_row` | 移植，欄位改為設定檔 | 轉型正義 Excel 格式為預設模板 |
| `writeMainSheet(ws, rows, template)` | `write_main_sheet` | 移植 | |
| `appendUnique(ws, rows)` | `update_main`、`sheet_ids` | 移植 | 依 ID 去重，避免重複列 |
| `writeAnalysisSheet(ws, groups)` | `update_analysis`、`export_analysis` | 移植 | 綜合分析表 |
| `writeStatSheet(ws, stats)` | `export_stat` | 移植 | |
| `linkCell(cell, url, text)` | `set_link` | 移植 | 判決連結、PDF 連結 |
| `checkWorkbook(path)` | `check` | 移植 | 匯出後自我檢查 |
| `ensureMethodColumn(ws)` | `ensure_method_col` | 移植 | |
| `snapshot(ws)` / `restoreIfBroken` | `snapshot` | 移植，改為寫入前備份 | 防止半途失敗毀掉原檔 |

## 5. Word 輸出（packages/core/word）

| 函數 | 來源 | 狀態 | 說明 |
|---|---|---|---|
| `cnNum(n)` | `export_word.cn_num` | 移植 | 中文數字 |
| `autoWidths(header, rows, total)` | `export_word.auto_widths` | 移植 | 表格欄寬 |
| `buildCaseDoc(groups, layout)` | `export_word.case_doc` | 移植 | 依群組輸出案件分析 |
| `buildPosNegDoc`、`buildStatDoc` | `export_pos`、`export_neg`、`export_stat` | 移植 | |
| `Layout` | `export_word.Layout` | 移植，改為設定檔 | 版面（字型、邊界、顏色） |
| `buildBriefDoc(summary, highlights, opts)` | 新增 | **新增** | 單一判決精讀（§7） |

## 6. PDF 與影像（packages/core/pdf）

| 函數 | 來源 | 狀態 | 說明 |
|---|---|---|---|
| `pdfUrl(id, title)`、`fetchJudgmentPdf(id)` | `update_excel.pdf_url` | 移植／新增下載 | |
| `extractTextFromPdf(buf)` | 新增 | **新增** | 新式 PDF：直接抽文字 |
| `pdfToPageImages(buf, dpi)` | 新增 | **新增** | 舊式 PDF：轉影像 |
| `layoutFourPerPage(images)` | 新增 | **新增** | 每頁 4 格貼入 Word |
| `ocrPages(images)` | 新增 | **新增（可選，預設關閉）** | 見 SPEC §9 待確認事項 |
| `highlightRanges(text, ranges, colors)` | 新增 | **新增** | 依重點類型標示螢光色 |

## 7. AI 功能（packages/core/ai）— 全部為新增

### 7.1 供應商介面

| 函數 | 說明 |
|---|---|
| `interface AiProvider { complete(req: AiRequest): Promise<AiResponse> }` | 統一介面：messages、model、maxTokens、jsonSchema（可選）、temperature |
| `AnthropicNative` | 原生 Messages API；PDF、引用、思考、快取走這條路 |
| `OpenAICompatible(baseUrl, key)` | 通用端點（OpenAI、OpenRouter、Gemini 相容端點、DeepSeek、Ollama） |
| `ProxyProvider(baseUrl, idToken)` | 訂閱制代理（`aiProxy`），與上面兩者同介面 |
| `estimateCost(usage, price)` | 依 token 數估算費用，用於顯示與配額提示 |
| `validateKey(provider)` | 設定時做一次最小呼叫，確認金鑰與模型可用 |

### 7.2 任務型函數

| 函數 | 對應需求 | 輸入 → 輸出 |
|---|---|---|
| `planStrategy(goal, provider)` | 綜合分析流程：目標 → 策略 | 研究目標文字 → `SearchStrategy`（關鍵字、條文、法院、期間、篩選規則），需使用者審閱後才執行 |
| `reviewStrategy(strategy, preview)` | 策略審閱 | 策略＋樣本結果 → 建議修改（AI 可選） |
| `proposeDimensions(records, goal, provider)` | AI 提議分類 | 列表＋目標 → 分類維度與各類定義 |
| `classifyJudgments(records, dims, provider)` | AI 自動分類 | 列表＋維度 → 每筆的類別與理由（可逐筆覆寫） |
| `subdivideGroup(group, provider)` | AI 細分與分群 | 單一群組 → 子群 |
| `synthesizeGroup(group, columns, provider)` | 綜合分析表 | 群組＋欄位定義 → 每欄的摘要（爭點、認定標準、結論、引用條文） |
| `summarizeJudgment(detail, focus, length, provider)` | 單一判決精讀 | 全文＋重點＋長度 → 摘要條目，每條附原文段落 ID |
| `locateSupportingText(summaryItem, detail)` | 螢光標示的依據 | 摘要條目 → 原文段落範圍（用於標示） |
| `inferFocusIfMissing(detail, provider)` | 未指定重點時 | 全文 → 建議重點 |

所有任務型函數都要求 JSON 輸出，並在本機驗證結構；驗證失敗時重試一次，仍失敗則回報，不默默略過。

### 7.3 Prompt 與設定

| 項目 | 說明 |
|---|---|
| `PromptTemplate` | 每個任務的提示詞模板，存於使用者設定檔，可匯入匯出（第三層設定） |
| `ProjectConfig` | 分類維度、欄位、顏色規則、Word 版面、預設模型 |

## 8. 快取與儲存（packages/core/store）

| 函數 | 來源 | 狀態 | 說明 |
|---|---|---|---|
| `getJudgment(id, crawl)` | `functions/src/cache.ts` | 新增（雲端已實作） | 全文永久快取 |
| `getSearch(params, crawl, ttl)` | `functions/src/cache.ts` | 新增（雲端已實作） | 搜尋結果 TTL 7 天 |
| `LocalStore`（SQLite） | 新增 | **新增** | 桌面端本機快取、專案、策略、AI 結果 |
| `BatchProgress` | `recovery_pipeline.get_completed_case_ids`、`append_case_result`、`update_progress` | 移植 | 批次作業中斷後可續跑 |
| `SecretStore` | 新增 | **新增** | 金鑰存於 Windows 憑證管理員，不寫入檔案 |

## 9. 雲端與認證（packages/core/cloud，遠端 MCP 與桌面端共用）

| 函數 | 說明 |
|---|---|
| `verifyIdToken(token)` | Firebase ID Token 驗證（遠端 MCP 的 `requireUser`） |
| `checkSubscription(uid)` | 有效訂閱與本月用量（`aiProxy` 內部） |
| `ProxyProvider` | 見 §7.1 |
| `BillingClient`（隱藏 Beta） | `billingCheckout` 呼叫；未開放時 UI 不顯示入口 |

## 10. 應用層（packages/app，桌面端 UI 與流程）

| 函數 | 說明 |
|---|---|
| `runPipeline(stage, input)` | 四段管線的排程：檢索 → 列表 → 分群分析 → 精讀；每段可獨立執行與重跑 |
| `exportOutputs(kind, data, format)` | 統一的匯出入口（Excel／Word） |
| `checkUpdate()`、`applyHotfix()` | 自動更新與熱修復（electron-updater） |
| `openSettings(section)` | 三層設定的入口 |
| `estimateRun(plan)` | 執行前估算：檢索筆數、全文下載量、AI token 與費用，超過門檻時先確認 |

## 11. MCP 工具對應（遠端與桌面共用）

| MCP 工具（沿用 `judge_mcp`） | 核心函數 |
|---|---|
| `quick_search` | `searchJudgments`（摘要欄位） |
| `search_judgments` | `searchJudgments` + `extractSnippets` |
| `extract_snippets` | `extractSnippets` |
| `get_judgment_detail` | `getJudgmentDetail`（經 `getJudgment` 快取） |
| `get_judgment_summary` | `getJudgmentDetail`，僅回傳 metadata |
| `search_by_case_number` | `searchByCaseNumber` |
| `get_court_list` | `getCourtList` |
| `process_text` | `cleanText`、`reflowText`、`sentenceSplitChinese` |

## 12. 捨棄或不納入第一階段

- `analyze_main_texts.py`、`add_numbering_column.py`、`fix_layout.py`：一次性的維護腳本，除非之後需要，否則不移植。
- `dump_*.py`、HTML 傾印：改為測試夾具。
- 命令列互動的法院選擇：改由 UI 呈現。

## 13. 還沒定案的事項

1. 「33 種檔案類型」的完整清單：每一種對應哪些函數，目前無法列出，需要使用者提供。
2. 舊式 PDF 是否做 OCR，影響 §6 的 `ocrPages`。
3. 各 AI 任務的預設模型與 prompt，需要實測後定案。
4. 策略審閱是否預設啟用：會增加一次 AI 呼叫，但能避免錯誤策略浪費爬取量。
