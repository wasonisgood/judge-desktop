# 跨平臺狀態與發版流程

狀態：2026-11-09 版。本文件記錄 Windows／macOS／Linux 的實作狀態、已修正的問題、仍待處理的事項，以及發版流程。

## 1. 各平臺目前能做什麼

| 功能 | Windows | macOS | Linux |
|---|---|---|---|
| 判決列表、範圍整理、精讀、檔案、設定 | 完整 | 完整（建置後未在實機驗證） | 完整（建置後未在實機驗證） |
| 匯出 Excel／Word | 完整 | 完整（字型見第 4 節） | 完整（字型見第 4 節） |
| 金鑰加密保存（safeStorage） | 完整 | 使用鑰匙圈 | 需要系統的 secret service（如 GNOME Keyring、KWallet）；沒有時無法保存金鑰，程式會說明原因 |
| 應用程式內自動更新 | 有（C# 更新程式） | 無，請到 Releases 下載 | 無，請到 Releases 下載 |
| 本地 AI（Ollama 引擎與模型） | 完整 | **未實作**：偵測與引擎安裝只寫了 Windows 版 | **未實作**（同上） |
| 爬取模組（司法院） | 完整 | 與 Windows 共用程式碼，未實機驗證 | 同左 |
| 法規資料（立法院） | 以系統 curl 連線 | 以系統 curl 連線，**未驗證** | 以系統 curl 連線，**未驗證** |
| 安裝程式 | C# 安裝器（JudgeResearchSetup.exe） | dmg／zip | AppImage／deb／rpm |

「未實機驗證」表示：程式碼與建置設定已檢查，但這台開發機是 Windows，沒有 macOS 或 Linux 可執行。CI（GitHub Actions）會建置出安裝包，實際執行仍需要在對應系統上測試。

## 2. 已修正的問題

| 位置 | 問題 | 處理 |
|---|---|---|
| `apps/desktop/src/main/windows/mainWindow.ts` | 一律 `Menu.setApplicationMenu(null)`。macOS 沒有編輯選單，複製、貼上、全選等快捷鍵會失效。 | macOS 保留最小的應用程式選單與編輯選單；Windows、Linux 維持無選單。 |
| `apps/desktop/src/renderer/js/controllers/settings.js` | 「檢查更新」在非 Windows 版顯示「此為開發版本」，與實際情況不符。 | 說明改為：開發版，或 macOS／Linux 版；請到 GitHub Releases 下載。 |
| `apps/desktop/src/renderer/css/base.css` | 無排版字型時，Linux 上中文字型不一定有 Microsoft JhengHei 或 PingFang TC。 | 字型清單加入 Noto Sans TC。 |
| `apps/desktop/electron-builder.yml` | 只設定 Windows（dir）。 | 新增 macOS（dmg、zip；x64 與 arm64）與 Linux（AppImage、deb、rpm；x64）。 |
| `.github/workflows/release.yml` | 整條流程只跑在 windows-latest。 | 拆為 shared、windows、linux、macos、release 五個工作，見第 5 節。 |
| `apps/desktop/src/main/services/updaterService.ts` 等 | `tasklist.exe`、`powershell.exe` 等 Windows 指令 | 已確認皆在 `process.platform === 'win32'` 條件下執行，非 Windows 會直接略過。 |

## 3. 已知限制（尚未實作）

1. **本地 AI 只支援 Windows。** `apps/desktop/src/main/data/local/system.ts` 的硬體偵測與 CPU 架構判讀只有 PowerShell 版本。在 macOS、Linux 會回報「本地 AI 目前只支援 Windows」，程式其餘功能改走雲端。要支援需要：
   - 硬體：macOS 用 `sysctl`，Linux 用 `/proc/meminfo` 與 `df`；
   - 引擎資產：Ollama 在 macOS 與 Linux 的發佈檔格式與 Windows 的 zip 不同（Linux 為 tgz），`packages/core` 的資產選擇與 `engineInstaller.ts` 的解壓都要改；
   - 執行檔名稱（`ollama`，非 `ollama.exe`）與數位簽章檢查（macOS 用 `codesign`，Linux 無等價檢查）。
   建議先在 macOS 實機上確認 Ollama 的資產名稱與權限行為，再實作。
2. **應用程式內更新只有 Windows。** 非 Windows 版本需要使用者到 Releases 手動下載。
3. **macOS 未簽章、未公證。** 目前以 ad-hoc 簽章（`identity: "-"`）產出，Gatekeeper 會阻擋，使用者需在 Finder 中右鍵點「打開」。正式發布前需要 Apple 開發者憑證（Developer ID Application）與公證（notarization）。這需要維護者設定 secrets（例如 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、憑證），流程不能由程式碼單獨完成。
4. **應用程式圖示解析度。** `apps/desktop/build/icon.png` 為 256×256。macOS 的 icns 建議至少 512×512（最好 1024×1024）。目前可以產出，但圖示在 Retina 螢幕上可能模糊。
5. **法規資料的 TLS 行為未在 macOS、Linux 驗證。** 立法院站不支援 Node 預設的安全重新協商，因此程式改用系統的 curl（`packages/core/src/law/curlFetch.ts`）。Windows 內建 curl 使用 Schannel 可以連線；macOS 的 curl 與 Linux 的 OpenSSL 版本是否能連線，需要實機確認。若不能，會以「無法連線」的方式呈現，不會默默失敗。
6. **Word 字型。** 匯出 Word 指定字型為「Microsoft JhengHei」。Windows 的 Office 有此字型；macOS 的 Office 與 Linux 上的 LibreOffice 可能改用其他字型，文字內容不受影響，版面可能略有差異。

## 4. 字型與排版

- 介面：`--serif` 與 `--sans` 已含 Noto Serif TC、Noto Sans TC、PingFang TC、Microsoft JhengHei。
- 匯出文件：docx 以 Microsoft JhengHei 為指定字型（見第 3 節第 6 點）。

## 5. 發版流程（`.github/workflows/release.yml`）

```
shared (ubuntu)  ──┬──> windows (windows-latest) ──┐
  核心 dist          ├──> linux (ubuntu-latest) ─────┼──> release (ubuntu)：彙整檔案、建立 Release
  模組目錄 modules.json ├──> macos (macos-latest) ───┘
```

- **共用一次**：`shared` 建置與平臺無關的部分（核心套件的 JavaScript 輸出、模組目錄）。各平臺工作以 artifact 下載，不重複建置。
- **各平臺各自安裝**：`node_modules` 與原生模組（`@napi-rs/canvas`）與平臺相關，只能在該平臺安裝。npm 下載以 `actions/setup-node` 的 npm 快取重用。
- **Electron 與 electron-builder 快取**：依作業系統與 `package-lock.json` 的雜湊作為快取鍵，同一版本不重複下載。
- **Windows** 仍使用 C# 安裝器（`installer/build_installer.ps1`）與 SignPath 簽章說明；安裝器完整性檢查保留。
- **macOS** 產出 dmg 與 zip（x64、arm64）。**Linux** 產出 AppImage、deb、rpm（x64）。
- **release** 工作檢查每個平臺的檔案都存在，才建立 Release。
- 成本注意：macOS 執行環境的計費單價高於 Linux 與 Windows。若只需要 Windows 與 Linux，可在 `macos` 工作加上 `if:` 條件。

### 驗證方式

- 本機以 `npx electron-builder --linux dir --publish never` 驗證 Linux 設定（已通過）。
- 其餘平臺的安裝包與產出檔名由 CI 驗證。
- 工作流程的 YAML 以 `js-yaml` 解析檢查（已通過）。

## 6. 維護者需要處理的事項

- [ ] 設定 Apple 簽章與公證的 secrets，並在 `macos` 工作加入簽章與公證步驟。
- [ ] 提供 512×512 以上的圖示（`icon.png`，並可產生 `icon.icns`）。
- [ ] 補上 `apps/desktop/electron-builder.yml` 的 `linux.maintainer` 可聯絡的 Email（目前只有名稱；deb、rpm 的維護者欄位需要）。
- [ ] 在 macOS 與 Linux 實機測試：啟動、匯出、金鑰保存、法規資料連線。
- [ ] 決定是否支援 macOS／Linux 的本地 AI（見第 3 節第 1 點），並排入後續版本。
