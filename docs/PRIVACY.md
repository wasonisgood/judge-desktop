# 隱私說明 / Privacy Statement

## 中文

司法院裁判研究（以下稱本程式）是在使用者電腦上執行的桌面應用程式。

### 登入

- 使用本程式的所有功能前，都需要先以帳號登入（Email 或 Google）。登入由 judge-remote-mcp 的授權服務（https://judge-remote-mcp-2026.web.app）處理。
- 登入後取得的權杖以 Windows 的資料保護機制加密後保存在使用者電腦上；權杖過期或被撤銷時，會要求重新登入。
- 授權服務會保存帳號的識別碼（uid）與登入相關紀錄，用於確認帳號。

### 保存在使用者電腦上的內容

- **檔案管理**：判決列表、範圍整理與精讀的結果，保存在應用程式資料夾內（library.json）。
- **個案研究筆記**：標注檔（annotations.json）。
- **檢索快取**：關鍵字與搜尋結果、判決內頁的快取，快取期限可在設定中調整，也可以手動清除。
- **AI 金鑰**：使用者自行輸入的 AI 服務金鑰，以 Windows 的資料保護機制加密保存。
- **匯出檔案**：Word、Excel 等匯出檔案，存放在使用者的文件資料夾中。

### 雲端同步（目前的實際範圍）

- **同步只在使用者主動按下「立即同步」時進行**，程式不會在背景自動上傳。
- **目前已實作的同步內容：個案研究筆記的標注檔**，包括：
  - 標注：所選文字的位置、顏色、模式，以及**使用者選取的判決原文片段（引用文字）**；
  - 註解文字；
  - 四色名稱；
  - 判決的顯示資訊：案號、標題、法院、日期、案由、來源網址、管轄區；
  - 刪除紀錄（記錄哪些標注已被刪除，避免被舊資料帶回）。
- 上傳的內容儲存在伺服器上，依帳號隔離，只能由該帳號存取。
- **同步服務已開放**：使用者登入後，按「立即同步」即可使用。
- **目前尚未上傳的內容**：範圍整理結果、精讀結果、判決列表結果、匯出檔案的內容。這些內容目前只保存在使用者電腦上。若未來要把它們納入同步，本聲明會先更新，並由使用者另行決定是否啟用。
- **將隨版本提供的功能**：編碼結果、研究設計摘要。這兩項功能正在開發中，將隨版本合併提供；屆時其同步範圍仍依本聲明（只在使用者主動同步時上傳），並會在版本發布時更新本聲明。在目前的版本中，這兩項內容不會上傳。

### 不會上傳的內容

- 判決全文；
- AI 金鑰；
- 檢索快取；
- 處理過程中的暫存資料（例如精讀或範圍整理過程的中間資料）；
- 匯出檔案的內容（目前）。

### 引用文字的注意事項

標注會保存使用者選取的判決原文片段（引用文字）。這些片段會隨標注一起上傳到同步服務。若不希望某段原文被上傳，請在同步前刪除對應的標注。

### 刪除

- **本機**：刪除標注或結果後，即從本機檔案中移除；也可以刪除應用程式資料夾。
- **雲端**：目前尚未提供刪除同步資料的操作。若需要刪除已同步的資料，請聯絡開發者。這是尚未完成的功能。

### 其他

- **對外連線**：本程式會連線到司法院裁判書查詢系統（judgment.judicial.gov.tw）取得公開判決；使用 AI 功能時，會把判決原文傳送給使用者設定的 AI 服務，金鑰只會傳送給該服務。登入與同步會連線到 judge-remote-mcp（https://judge-remote-mcp-2026.web.app）。更新檢查會連線到 GitHub 取得最新版本資訊。
- **工作負載身分聯盟**（選用）：使用者選擇此驗證方式時，本程式會向 judge-remote-mcp 以登入權杖申請短效身分權杖，再交給 Anthropic 換取 API 權杖。身分權杖的主體（sub）是使用者 Firebase 帳號 uid 的 SHA-256 雜湊前 32 碼，不會直接傳送原始 uid；權杖只用於本次換取，不保存在本機。
- **不使用追蹤或廣告工具。**
- **移除**：解除安裝時可選擇保留或刪除本機資料；也可以手動刪除應用程式資料夾。

聯絡方式：請在本 repo 開啟 Issue。

## English

Judge Research Desk (the "App") is a desktop application that runs on the user's computer.

### Sign-in

- All features of the App require the user to sign in first (email or Google). Sign-in is handled by the authorization service of judge-remote-mcp (https://judge-remote-mcp-2026.web.app).
- The login token is encrypted with Windows data protection and stored on the user's computer. When the token expires or is revoked, the user must sign in again.
- The authorization service stores the account identifier (uid) and sign-in records, which are used to identify the account.

### Stored on the user's computer

- **File management**: results of judgment lists, scope tables, and briefs, stored in the application folder (library.json).
- **Case notes**: the annotation file (annotations.json).
- **Search cache**: keywords, search results, and judgment page cache. The cache lifetime can be changed in Settings, and it can be cleared manually.
- **AI keys**: API keys entered by the user, encrypted with Windows data protection.
- **Exported files**: Word and Excel files, saved in the user's Documents folder.

### Cloud sync (current actual scope)

- **Sync happens only when the user presses "Sync now".** The App does not upload in the background.
- **Currently implemented: the case-note annotation file**, which contains:
  - annotations: the position, color, and mode of each highlight, and **the judgment passages the user selected (quoted text)**;
  - comments;
  - the four custom color names;
  - display information about the judgment: case number, title, court, date, cause, source URL, and jurisdiction;
  - deletion records (which annotations were deleted, so old data cannot bring them back).
- Uploaded content is stored on the server per account and is accessible only to that account.
- **The sync service is open.** After signing in, the user can use "Sync now".
- **Not uploaded at present:** scope-table results, brief results, judgment-list results, and the contents of exported files. These remain only on the user's computer. If they are added to sync in the future, this statement will be updated first and the user will decide whether to enable it.
- **Features planned for a future release:** coding results and research design summaries. These are under development and will be included in a future release. When they are, their sync will follow this statement (uploaded only when the user syncs manually), and this statement will be updated at that release. In the current version, these two are not uploaded.

### What is never uploaded

- The full text of judgments;
- AI keys;
- the search cache;
- temporary working data produced during processing (for example, intermediate data from brief or scope runs);
- the contents of exported files (at present).

### Note on quoted text

Annotations store the judgment passages the user selected (quoted text). These passages are uploaded together with the annotations. To keep a passage from being uploaded, delete its annotation before syncing.

### Deletion

- **On the computer**: deleting an annotation or a stored result removes it from the local file. The application folder can also be deleted.
- **In the cloud**: there is currently no way to delete synced data. To request deletion of synced data, contact the developer. This is an unfinished feature.

### Other

- **Outgoing connections**: the App connects to the Judicial Yuan judgment database (judgment.judicial.gov.tw) to fetch public judgments. When AI features are used, the judgment text is sent to the AI service the user configured, and the AI key is sent only to that service. Sign-in and sync connect to judge-remote-mcp (https://judge-remote-mcp-2026.web.app). Update checks connect to GitHub to read the latest version information.
- **Workload identity federation** (optional): when the user chooses this authentication method, the App requests a short-lived identity token from judge-remote-mcp with its login token, then exchanges it with Anthropic for an API access token. The identity token's subject (sub) is the first 32 hex characters of the SHA-256 hash of the user's Firebase account uid; the raw uid is not sent. Identity tokens are used once for an exchange and are not stored on the computer.
- **No tracking or advertising tools.**
- **Removal**: the uninstaller lets the user keep or delete local data; the application folder can also be deleted manually.

Contact: open an Issue in this repository.
