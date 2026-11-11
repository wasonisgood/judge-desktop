# 助理覆蓋盤點（4.2.0）

本文件記錄懸浮 AI 助理能操作的範圍，供審查與後續補強使用。以程式碼為準：`apps/desktop/src/main/assistant.ts`、`services/assistantTools.ts`、`assistantUi.ts`，以及 `renderer/js/core/aiBridge.js`。

## 架構

每一輪對話送出「控制項目錄」（所有頁面中有 id 的欄位與按鈕，含目前值與選項；目前頁面完整、其他頁面只列 id 與標籤）。主程序只接受目錄中存在的 id，其餘一律拒絕。

| 類別 | 工具 | 執行方式 |
|---|---|---|
| 查詢（自動） | search_judgments、resolve_statute、read_judgment、list_saved | 直接執行，結果回給模型 |
| 畫面（立即） | open_page、ui_set、open_saved、ui_action（非覆核類） | 排入畫面更新，不呼叫 AI、不改動已保存資料 |
| 提議（需同意） | propose_scope、propose_brief、ui_click、saved_action、ui_action 的覆核（scopeReview） | 列為待確認，使用者按「同意執行」才執行 |

安全規則：
- 密碼、金鑰、權杖欄位只給 id 與標籤，**不給值，也不能填寫**（`SECRET_RE`）。
- 按鈕一律需要同意；頁面處理中（按鈕鎖定）時拒絕。
- 覆核會改動已保存結果，一律需要同意。
- `ui_action` 的每個動作都在主程序先驗證參數（`checkUiAction`）。
- 測試確認：控制項 id 跨頁唯一；主程序允許的每個頁面動作，渲染端都有分派。

## 逐頁覆蓋

| 頁面 | 狀態 | 說明 |
|---|---|---|
| 首頁、導覽 | 完整 | open_page |
| 研究設計 | 完整 | 專屬多輪對話（寫入欄位、試搜尋、帶入範圍整理）；欄位與按鈕也在目錄中 |
| 判決列表 | 完整 | 表單與按鈕（含 AI 篩選）有 id；列內「精讀這則」由 ui_action briefFromList |
| 段落檢索 | 完整 | 表單與按鈕有 id；列內「展開全文」由 ui_action semanticExpand |
| 標編碼標注工序 | 完整 | 表單與執行按鈕有 id；分析欄位新增、移除由 addScopeField、removeScopeField；覆核（接受、駁回、修改、批次接受高信心、還原）由 scopeReview（需同意）；跳至原文由 scopeOpenSource |
| 納入排除 | 完整 | 一句話輸入、AI 建議標準、標準列（setCriteria）、個人組合（載入、刪除）、執行與結果 |
| 單一判決精讀 | 完整 | 候選選定由 pickCandidate；全文標注由 annotateQuote（以原句標注，可附註解）；其餘按鈕有 id |
| 量化圖表 | 完整 | 欄位與按鈕有 id |
| 檔案 | 完整 | list_saved、open_saved、saved_action；匯入判決清單按鈕有 id |
| 工具（文本擷取） | 完整（需人工選檔） | 關鍵字與各步驟按鈕有 id；「選擇檔案」會開啟系統對話框，由使用者自己選檔 |
| 設定 | 完整（金鑰除外） | 一般設定可讀取與設定；儲存鈕有 id；聯盟設定步驟有 id |

## 刻意不做、需要使用者自己完成

1. **金鑰與密碼**：助理不能讀值，也不能填寫。這是安全設計，不是缺口。
2. **系統對話框**（選擇檔案、選擇儲存位置）：由作業系統處理。助理可以透過 ui_click 開啟對話框，但選檔由使用者自己完成。
3. **全文的滑鼠選取**：助理改用 annotateQuote 以原句標注，不模擬拖曳。

## 驗證

- `npm test`：`assistant-ui.test.mjs`（目錄清理與敏感值隱藏、設值檢查、目錄文字、工具迴圈的畫面動作與待確認項目、控制項 id 跨頁唯一、頁面動作參數與覆核需確認、主程序與渲染端的動作一致）。
- 實際在應用程式中以對話操作各頁，應於安裝後抽測。
