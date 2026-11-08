# 司法院裁判研究（judge-desktop）

Windows 桌面應用程式，用來檢索司法院公開的裁判書，並整理成表格或精讀文書。

## 功能

- **判決列表**：依關鍵字搜尋，匯出 Excel。可選擇逐筆取得全文。
- **範圍整理表**：依法規列出確實引用該法規的判決。每則判決與每部法規的綜合分析由 AI 產生，匯出 Excel 或 Word。
- **單一判決精讀**：由 AI 整理成結構化文書，原判決主文以螢光標示，匯出 Word。

## 下載與安裝

1. 到 [Releases](https://github.com/wasonisgood/judge-desktop/releases/latest) 下載 `JudgeResearchSetup.exe`。
2. 執行安裝檔，依畫面選擇安裝位置與捷徑。
3. 第一次執行時，Windows 可能顯示 SmartScreen 警告，點「其他資訊」再點「仍要執行」。
4. 程式會在每次啟動時檢查新版本，有新版時自動下載並啟動安裝器。

## 使用 AI

範圍整理表與單一判決精讀需要 AI 服務。在「設定」輸入 API 金鑰即可。金鑰只保存在使用者自己的電腦，並以 Windows 加密機制保護。支援 Anthropic 與 OpenAI 相容的服務。

## 目錄結構

- `packages/core`：司法院檢索、解析、範圍整理、AI 分析（TypeScript）
- `apps/desktop`：Electron 桌面應用程式與介面
- `apps/desktop/installer`：C# 原生安裝器、解除安裝程式與更新程式
- `docs/`：規格與設計文件、程式碼簽章政策

## 授權

MIT License，見 [LICENSE](LICENSE)。
