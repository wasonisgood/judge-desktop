# 司法院裁判研究（judge-desktop）

Windows 桌面應用程式，用來檢索司法院公開的裁判書，並整理成表格或精讀文書。

## 功能

- **判決列表**：依關鍵字搜尋，匯出 Excel。可選擇逐筆取得全文。
- **標編碼標注工序**（原「範圍整理表」）：輸入關鍵字（可用一句話描述，支援智慧搜尋與相關法規）或法規（每行一部），列出判決；分析欄位（預設：分類、爭點、法院見解、法條適用、結論，可勾選、自訂、調整順序）由 AI 逐案編碼，每格附判決原文的逐字依據，對不上的標示為待覆核。匯出 Excel 或 Word。
- **單一判決精讀**：由 AI 整理成結構化文書，原判決主文以螢光標示，匯出 Word。

## 下載與安裝

1. 到 [Releases](https://github.com/wasonisgood/judge-desktop/releases/latest) 下載 `JudgeResearchSetup.exe`。
2. 執行安裝檔，依畫面選擇安裝位置與捷徑。
3. 第一次執行時，Windows 可能顯示 SmartScreen 警告，點「其他資訊」再點「仍要執行」。
4. 程式會在每次啟動時檢查新版本，有新版時自動下載並啟動安裝器。

**程式碼簽章**：本專案的 Windows 安裝檔由 [SignPath.io](https://signpath.io) 提供免費簽章，憑證由 SignPath Foundation 核發。（Free code signing provided by SignPath.io, certificate by SignPath Foundation.）

## 使用 AI

範圍整理表與單一判決精讀需要 AI 服務。在「設定」輸入 API 金鑰即可。金鑰只保存在使用者自己的電腦，並以 Windows 加密機制保護。支援 Anthropic 與 OpenAI 相容的服務。

## 系統需求與 .NET

- 應用程式本身（Electron）與本地模組（AI 引擎、爬取模組）不需要 .NET；模組安裝與更新使用 Windows 內建的 PowerShell。
- 安裝程式（`JudgeResearchSetup.exe`）與更新程式（`JudgeResearchUpdater.exe`）是 .NET Framework 4 程式。Windows 10（1903 之後）與 Windows 11 已內建 .NET Framework 4.8。若安裝程式無法啟動，請到微軟官方網站安裝 [.NET Framework 4.8](https://dotnet.microsoft.com/download/dotnet-framework/net48)，然後重新執行安裝程式。
- 模組更新不需要更新程式：模組檔案由應用程式內直接下載與校驗（先 Firebase Storage 鏡像，失敗再 GitHub）。

## 本地 AI（可選，3.0 起）

設定頁的「本地 AI」可檢查這台電腦是否適合在本機執行 AI（依記憶體、磁碟與顯卡分級）。同意後才會安裝本地服務（Ollama）與模型；精讀與範圍整理優先使用本地模型，失敗時自動改用雲端。不適合或未安裝時，行為與以前相同。

## 隱私

本程式不收集個人資料。檢索結果、AI 金鑰與判決內容都只保存在使用者電腦上。詳見 [隱私說明](docs/PRIVACY.md)。

## 目錄結構

- `packages/core`：司法院檢索、解析、範圍整理、AI 分析（TypeScript）
- `apps/desktop`：Electron 桌面應用程式與介面
- `apps/desktop/installer`：C# 原生安裝器、解除安裝程式與更新程式
- `docs/`：規格、設計文件、程式碼簽章政策、隱私說明

## 授權

MIT License，見 [LICENSE](LICENSE)。

---

# Judge Research Desk (English)

A Windows desktop application for searching public judgments from the Judicial Yuan of Taiwan, and organizing them into tables or reading briefs.

## Features

- **Judgment list**: search by keyword and export to Excel. Full text can be fetched per judgment.
- **Scope tables**: list judgments that actually cite a chosen statute. AI produces per-case analysis and a cross-case synthesis per statute; export to Excel or Word.
- **Single-judgment brief**: AI produces a structured brief; the original main text is highlighted; export to Word.

## Download and installation

1. Download `JudgeResearchSetup.exe` from [Releases](https://github.com/wasonisgood/judge-desktop/releases/latest).
2. Run the installer and choose the install location and shortcuts.
3. On first run, Windows may show a SmartScreen warning. Click "More info", then "Run anyway".
4. The app checks for updates at every launch. When a newer version is available, it downloads and starts the installer automatically.

**Code signing**: The Windows installer is signed for free by [SignPath.io](https://signpath.io), with the certificate issued by the SignPath Foundation. (Free code signing provided by SignPath.io, certificate by SignPath Foundation.)

## Using AI

Scope tables and single-judgment briefs require an AI service. Enter an API key in Settings. The key is stored only on the user's computer, protected by Windows encryption. Anthropic and OpenAI-compatible services are supported.

## Privacy

The app does not collect personal data. Search results, AI keys and judgment text stay on the user's computer. See the [privacy statement](docs/PRIVACY.md).

## Repository layout

- `packages/core`: Judicial Yuan search, parsing, scope tables and AI analysis (TypeScript)
- `apps/desktop`: Electron desktop application and UI
- `apps/desktop/installer`: native C# installer, uninstaller and updater
- `docs/`: specifications, design notes, code signing policy, privacy statement

## License

MIT License. See [LICENSE](LICENSE).
