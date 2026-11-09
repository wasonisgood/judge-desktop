# 跨平臺狀態與發版流程

狀態：2026-11-09 版。本文件記錄 Windows／macOS／Linux 的實作狀態、已修正的問題、仍待處理的事項，以及發版流程。

## 1. 各平臺目前能做什麼

| 功能 | Windows | macOS | Linux |
|---|---|---|---|
| 判決列表、範圍整理、精讀、檔案、設定 | 完整 | 完整（建置後未在實機驗證） | 完整（建置後未在實機驗證） |
| 匯出 Excel／Word | 完整 | 完整（字型見第 4 節） | 完整（字型見第 4 節） |
| 金鑰加密保存（safeStorage） | 完整 | 使用鑰匙圈 | 需要系統的 secret service（如 GNOME Keyring、KWallet）；沒有時無法保存金鑰，程式會說明原因 |
| 應用程式內自動更新 | 有（C# 更新程式） | 無，請到 Releases 下載 | 無，請到 Releases 下載 |
| 本地 AI（Ollama 引擎與模型） | 完整（zip） | 完整（`ollama-darwin.tgz`，Apple Silicon 與 Intel 共用；硬體以 sysctl 偵測） | 完整（amd64、arm64 的 `tar.zst`，需要系統的 zstd；硬體以 /proc/meminfo 偵測） |
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

1. **Linux 的 GPU 加速未偵測。** Linux 與 macOS 的本地 AI 目前以 CPU 方案計算（保守），不會自動使用 NVIDIA、AMD 顯卡或 Apple Metal 加速。要支援需要另外偵測顯卡（例如 `nvidia-smi`、`rocm-smi`）。
2. **Linux 需要 zstd。** Ollama 的 Linux 發佈檔是 `tar.zst`，安裝時以系統的 `tar --zstd` 解壓；若未安裝 zstd，安裝會失敗並提示安裝方式。
3. **macOS 的執行檔簽章不另外檢查。** 官方的 macOS 檔案已由 Ollama 簽章，程式不另外驗證（Windows 的 Authenticode 檢查只適用於 Windows）。
2. **應用程式內更新只有 Windows。** 非 Windows 版本需要使用者到 Releases 手動下載。
3. **macOS 未簽章、未公證。** 目前以 ad-hoc 簽章（`identity: "-"`）產出，Gatekeeper 會阻擋，使用者需在 Finder 中右鍵點「打開」。正式發布前需要 Apple 開發者憑證（Developer ID Application）與公證（notarization）。這需要維護者設定 secrets（例如 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、憑證），流程不能由程式碼單獨完成。
4. **應用程式圖示是放大的。** `apps/desktop/build/icon.png` 已由原本 256 像素的圖示放大為 1024×1024，供 macOS icns 與 Linux 使用。放大的圖示邊緣可能不如原生設計清楚；若有向量原稿，建議重新輸出。
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
- [x] `linux.maintainer` 已填入 wasonisgood <wasonisgood@gmail.com>（deb、rpm 用）。
- [ ] 在 macOS 與 Linux 實機測試：啟動、匯出、金鑰保存、法規資料連線。
- [ ] 視需要加入 Linux 與 macOS 的顯卡加速偵測（見第 3 節第 1 點）。
