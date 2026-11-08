# SignPath 免費開源簽章申請流程

狀態紀錄（2026-11-08）：repo 已改為公開；README 與隱私說明已補上（中英文）；申請表已用瀏覽器開啟並確認欄位，**尚未填寫、尚未送出**，待申請人本人填寫姓名與信箱後送出。

## 目前進度（2026-11-08，瀏覽器操作紀錄）

已填入（依截圖與輸入紀錄）：
- Project Name：司法院裁判研究
- Repository URL / Homepage URL：https://github.com/wasonisgood/judge-desktop
- Download URL：https://github.com/wasonisgood/judge-desktop/releases/latest
- Privacy Policy URL：https://github.com/wasonisgood/judge-desktop/blob/master/docs/PRIVACY.md
- Tagline、Description（英文，含 MIT 授權與 repo 網址）
- Category：Productivity
- Reputation：如實說明為新專案（v0.2.2 於 2026-11-09 發行），尚無下載數與媒體報導
- Maintainer Type：Individual maintainer(s)
- Build System：GitHub Actions
- First Name：WEI XIANG；Last Name：PENG（依申請人指定的 PENG WEI XIANG 拆分，請確認順序）
- Email：wasonisgood@gmail.com（曾誤重複輸入，已改為單一值）
- Primary Discovery Channel：Organic search（點選後頁面凍結，尚未確認是否寫入）

尚未完成：
- Primary Discovery Channel 的確認、Exact source（選填，留空）
- reCAPTCHA 驗證
- 條款同意勾選（Code of Conduct）與隱私同意勾選
- 送出（Submit）按鈕尚未點擊

操作障礙：瀏覽器分頁在選完 Primary Discovery Channel 後無回應（截圖與捲動逾時），需重新整理或重開分頁後，從頭核對欄位再完成。

## 為什麼還不能送出（已解除，保留紀錄）

1. **Repo 仍是私有的。** SignPath 要驗證「二進位檔是由公開的開源 repo 建置」，私有 repo 無法通過驗證。
2. **下載頁還沒提到 SignPath。** 表單的 Download URL 欄位要求下載頁必須說明「專案使用 SignPath Foundation 進行程式碼簽章」。目前 README 的下載頁說明還沒有這段。
3. **Privacy Policy URL。** 應用程式不收集使用者資料，但 AI 金鑰與檢索內容只存在本機，建議仍附上隱私說明，避免審核時被質疑。

## 申請前的準備（依序完成）

1. 將 `wasonisgood/judge-desktop` 改為公開（GitHub → Settings → Danger Zone → Change visibility）。這一步會讓原始碼公開，需要你本人決定。
2. 確認 `LICENSE`（MIT）為 OSI 核准授權，且 repo 內沒有非開源元件。目前已符合。
3. 在 `README.md` 的下載段落加上：「本專案的 Windows 安裝檔由 SignPath.io 提供免費簽章，憑證由 SignPath Foundation 核發。」（已在 `docs/CODE_SIGNING.md` 寫好文字）。
4. 撰寫隱私說明 `docs/PRIVACY.md`。
5. 確認 Releases 頁面可以公開下載，且產品版本與建置版本一致（目前 v0.2.2）。

## 申請表欄位（https://signpath.org/apply）

| 欄位 | 必填 | 建議填入 |
|---|---|---|
| Project Name | 是 | 司法院裁判研究（需與安裝檔的產品名稱一致） |
| Repository URL | 是 | https://github.com/wasonisgood/judge-desktop |
| Homepage URL | 是 | https://github.com/wasonisgood/judge-desktop（或專案網頁） |
| Download URL | 否 | https://github.com/wasonisgood/judge-desktop/releases/latest（頁面需提到 SignPath） |
| Privacy Policy URL | 視情況 | 準備好 `docs/PRIVACY.md` 後填入其 GitHub 網址 |
| Wikipedia URL | 否 | 留空 |
| Tagline | 是 | 用一句話說明：司法院裁判的檢索、範圍整理與 AI 精讀桌面應用程式 |
| Category | 是 | 依表單選單選擇最接近的分類（例如工具或法律類） |
| Maintainer Type | 否 | 個人 |
| Build System | 是 | GitHub Actions |
| First Name / Last Name | 是 | 申請人本人的英文姓名（依 CLAUDE.md：PENG WEIXIANG） |
| Email | 是 | 申請人本人的聯絡信箱（由申請人自行填寫） |
| Company Name | 否 | 留空 |
| Primary Discovery Channel | 是 | 依實際管道選擇 |

個人資料（姓名、信箱）由申請人本人填寫，不由助理代填。

## 送出後的步驟

1. SignPath 會審核；官方頁面沒有寫明審核時間，二手資料提到約一週，僅供參考。
2. 核准後，SignPath 提供專案的簽章政策頁與 API token。
3. 在 GitHub 的 repo secrets 加入 `SIGNPATH_API_TOKEN`，並在發版工作流程加入 `signpath/github-action-submit-signing-request`，對安裝檔與執行檔送審。
4. 每次發版，申請人在 SignPath 介面人工核准簽章請求（條款要求每次都要人工核准）。
5. 簽章完成後，工作流程上傳已簽章的 `JudgeResearchSetup.exe`。

## 條款要求摘要（來源：https://signpath.org/terms）

- OSI 核准的開源授權，所有元件都不能是非開源。
- 專案必須持續維護，且已正式發行。
- 只能簽署自己的專案與自己建置的檔案。
- 所有團隊成員都要開啟 MFA（SignPath 與 GitHub）。
- 簽章者顯示為 SignPath Foundation，不是申請人個人名稱。
- 違反條款可能被暫停或撤銷憑證。
