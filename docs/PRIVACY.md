# 隱私說明 / Privacy Statement

## 中文

司法院裁判研究（以下稱本程式）是在使用者電腦上執行的桌面應用程式。

- **需要登入。** 使用本程式的所有功能前，都需要先以帳號登入（Email 或 Google）。登入由 judge-remote-mcp 的授權服務（https://judge-remote-mcp-2026.web.app）處理；登入後取得的權杖以 Windows 的資料保護機制加密後保存在使用者電腦上，權杖過期或被撤銷時會要求重新登入。授權服務會保存帳號的識別碼（uid）與登入相關紀錄，用於確認帳號與提供同步功能。
- **不收集其他個人資料。** 除了登入所需的帳號資訊之外，本程式不會收集個人資料，也不會把使用者的資料傳送給開發者。
- **檢索內容**：關鍵字與搜尋結果只保存在使用者電腦上（應用程式資料夾內的快取），快取期限可在設定中調整，也可以手動清除。
- **個案研究筆記（標注與註解）**：標注檔案（annotations.json）保存在使用者電腦上。標注會保存使用者所選取的文字片段（引用文字）、其位置、顏色、註解、四色名稱，以及判決的案號、標題、法院、日期、案由與來源網址等顯示資訊。
- **雲端同步（使用者主動按下「立即同步」才會進行）**：同步時會把上述標注檔案的內容（標注、註解、四色名稱、判決的顯示資訊、刪除紀錄）上傳到 judge-remote-mcp，並儲存在伺服器上、只能由該帳號存取。同步**不包含判決全文**、AI 金鑰、檢索快取或精讀結果。但標注中包含使用者選取的判決原文片段，這些片段會一併上傳。伺服器端目前尚未提供「刪除雲端同步資料」的操作，這是尚未完成的功能；若需刪除，請聯絡開發者。
- **AI 金鑰**：使用者自行輸入的 AI 服務金鑰，以 Windows 的資料保護機制加密後保存在使用者電腦上。金鑰只會傳送給使用者設定的 AI 服務，不會傳送給開發者、同步伺服器或其他第三方。
- **對外連線**：本程式會連線到司法院裁判書查詢系統（judgment.judicial.gov.tw）取得公開判決；使用 AI 功能時，會把判決原文傳送給使用者設定的 AI 服務。登入與同步會連線到 judge-remote-mcp（https://judge-remote-mcp-2026.web.app）。更新檢查會連線到 GitHub 取得最新版本資訊。
- **工作負載身分聯盟**（選用）：使用者選擇此驗證方式時，本程式會向 judge-remote-mcp 以登入權杖申請短效身分權杖，再交給 Anthropic 換取 API 權杖。身分權杖的主體（sub）是使用者 Firebase 帳號 uid 的 SHA-256 雜湊前 32 碼，不會直接傳送原始 uid；權杖只用於本次換取，不保存在本機。
- **不使用追蹤或廣告工具。**
- **移除**：解除安裝時可選擇保留或刪除本機資料；也可以手動刪除應用程式資料夾。

聯絡方式：請在本 repo 開啟 Issue。

## English

Judge Research Desk (the "App") is a desktop application that runs on the user's computer.

- **Login required.** All features of the App require the user to sign in first (email or Google). Sign-in is handled by the authorization service of judge-remote-mcp (https://judge-remote-mcp-2026.web.app). The resulting login token is encrypted with Windows data protection and stored on the user's computer; when the token expires or is revoked, the user must sign in again. The authorization service stores the account identifier (uid) and sign-in records, which are used to identify the account and to provide sync.
- **No other personal data is collected.** Beyond the account information needed for sign-in, the App does not collect personal data and does not send user data to the developer.
- **Search data**: keywords and search results stay on the user's computer in a local cache. The cache lifetime can be changed in Settings, and it can be cleared manually.
- **Case notes (annotations and comments)**: the annotation file (annotations.json) is stored on the user's computer. It holds the text passages the user selected (quoted text), their positions, colors, comments, custom color names, and display information about the judgment (case number, title, court, date, cause, source URL).
- **Cloud sync (only when the user presses "Sync now")**: sync uploads the contents of the annotation file (annotations, comments, color names, judgment display information, deletion records) to judge-remote-mcp, where they are stored per account and accessible only to that account. Sync does **not** include the full text of judgments, AI keys, the search cache, or brief results. However, annotations contain the judgment passages the user selected, and those passages are uploaded with them. Deleting synced data from the server is not yet available; this is an unfinished feature, so contact the developer to request deletion.
- **AI keys**: API keys entered by the user are encrypted with Windows data protection and stored on the user's computer. A key is sent only to the AI service the user configured, never to the developer, the sync server, or other third parties.
- **Outgoing connections**: the App connects to the Judicial Yuan judgment database (judgment.judicial.gov.tw) to fetch public judgments. When AI features are used, the judgment text is sent to the AI service the user configured. Sign-in and sync connect to judge-remote-mcp (https://judge-remote-mcp-2026.web.app). Update checks connect to GitHub to read the latest version information.
- **Workload identity federation** (optional): when the user chooses this authentication method, the App requests a short-lived identity token from judge-remote-mcp with its login token, then exchanges it with Anthropic for an API access token. The identity token's subject (sub) is the first 32 hex characters of the SHA-256 hash of the user's Firebase account uid; the raw uid is not sent. Identity tokens are used once for an exchange and are not stored on the computer.
- **No tracking or advertising tools.**
- **Removal**: the uninstaller lets the user keep or delete local data; the application folder can also be deleted manually.

Contact: open an Issue in this repository.
