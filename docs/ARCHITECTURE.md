# 桌面端架構（judge-desktop）

更新：2026-11-11。全域架構（三個存儲庫、發版、雲端端點）見 `judge-shared/docs/ARCHITECTURE.md`；全域進度見 `judge-shared/docs/STATUS.md`。

## 1. 本存儲庫的內容

- `apps/desktop/src/main`：Electron 主程序（IPC 處理、本機設定與金鑰、本地模組、更新、精靈、匯出）。
- `apps/desktop/src/renderer`：只剩桌面專屬的入口頁與腳本：`index.html`（標頭＋腳本）、`js/host.js`（把 preload 的 `window.api` 交給共用畫面）、`js/notify.js`（通知視窗）、`css/notify.css`、`wizard.html` 與 `wizard/`（本地模組安裝精靈，桌面專屬）。
- `apps/desktop/installer`：C# 安裝程式與更新程式。
- `apps/desktop/scripts`：冒煙測試、截圖、探測腳本（需要 Electron）。
- `knowledge/`：爭點知識庫的內容與工具。
- `.github/workflows/release.yml`：發版（Windows、macOS、Linux）。

## 2. 依賴

- `@judge/core`：tarball 網址釘住（`apps/desktop/package.json`）。核心的程式不在本存儲庫。
- `@judge/ui`：tarball 網址釘住。畫面（頁面、元件、樣式）的程式不在本存儲庫。建置時 `scripts/copy-renderer.mjs` 把它複製到 `dist/renderer/ui`。
- 升級依賴：改 `package.json` 的網址 → `npm install` → `npm run build` → `npm test`。

## 3. 建置與測試

```
cd apps/desktop
npm install
npm run build      # tsc + 複製渲染程序
npm test           # 單元測試（目前 230 項，3 項跳過）
```

冒煙測試（需要 Electron，會開視窗）：`npx electron scripts/ui-smoke.cjs`。截圖輸出到 `UI_SMOKE_DIR` 指定的目錄，避免弄髒 repo。

## 4. 發版

1. 升 `apps/desktop/package.json` 與 `package-lock.json` 的版本，`installer/release.json` 加上 zh／en 的 notes。
2. 提交、推送 `vX.Y.Z` 標籤 → `release.yml` 建置三個平台並建立 Release（含 `JudgeResearchSetup.exe`、`latest.json`）。
3. 首頁（網頁版）的下載連結自動指向最新 Release。

## 5. 已知事項

- 4.3.0 的 Release 使用的是 `@judge/core` 0.1.1；之後的 core 變更（0.1.2 的自然語言解析搬遷、ui 0.1.4 的保存訊息）要等下一次發版才會進入安裝檔。目前本地的程式已改為 core 0.1.2 與 ui 0.1.4，建置與測試通過。
- `docs/SPEC.md` §10 與雲端實際做法（司法院抓取位置）不一致，需要重新決定。
- 網頁版的待辦清單見 `judge-shared/docs/STATUS.md`。
