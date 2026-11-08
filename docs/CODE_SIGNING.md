# 程式碼簽章政策

本專案的 Windows 安裝檔與執行檔由 [SignPath.io](https://signpath.io) 提供免費簽章，憑證由 SignPath Foundation 核發。

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## 團隊角色

- **作者（Authors）**：撰寫並提交程式碼。目前為 wasonisgood。
- **審查者（Reviewers）**：審查非作者提交的變更。目前尚無其他審查者。
- **核准者（Approvers）**：核准每一次簽章請求。目前為 wasonisgood。

## 簽章規則

- 只簽署本專案自己建置的檔案，不簽署第三方的二進位檔。
- 每次發版都需要人工核准，建置必須可以從原始碼重現。
- 產品名稱固定為「司法院裁判研究」，產品版本與建置版本一致。
- 所有團隊成員都必須啟用多重驗證（MFA），包括 SignPath 與 GitHub 帳號。

## 隱私與移除

- 程式不會收集使用者的個人資料。檢索內容與 AI 金鑰只保存在使用者本機。
- 安裝器與解除安裝程式會說明所做的系統變更，並提供完整移除。

## 回報

如果發現本專案的簽章檔案有問題，請到 Issues 回報，或寄信至 support@signpath.io。
