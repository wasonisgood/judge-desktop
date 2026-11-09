# 登入（OAuth 2.1 + PKCE，本機回呼）

狀態：2026-11-09 版。桌面端的登入閘門已實作；授權頁的 Google 登入與 Firebase 設定尚未完成（見第 4 節）。

## 1. 流程

1. 程式啟動時，主程序檢查本機登入狀態（`authStatus`）。未登入時，畫面顯示登入閘門，覆蓋主畫面（標題列仍可用）。
2. 第一次登入：向授權伺服器註冊桌面端用戶端（`POST /oauth/register`，公開客戶端，`token_endpoint_auth_method: none`），保存 `client_id`。
3. 產生 PKCE（`code_verifier` 32 位元組隨機值，`code_challenge` = S256）與 `state`（16 位元組隨機值）。
4. 在 `127.0.0.1:53682` 啟動一次性的本機回呼伺服器，並以系統瀏覽器開啟授權頁（`/oauth/authorize`）。
5. 使用者在授權頁登入。授權頁導回 `http://127.0.0.1:53682/callback?code=…&state=…`。
6. 回呼伺服器驗證 `state`（不符一律拒絕），取得授權碼後回應「登入完成」頁面，並關閉自己。
7. 主程序以授權碼與 `code_verifier` 換取 token（`POST /oauth/token`）。權杖以 `safeStorage` 加密後寫入 `userData/auth-session.json`。
8. 權杖過期前，`authStatus` 會以 refresh_token 更新；授權伺服器拒絕時（例如已撤銷）才清除本機工作階段。網路暫時失敗時保留工作階段。

登入等待上限 5 分鐘；取消或逾時會回到閘門並說明原因。埠 53682 被占用時會提示關閉占用的程式。

## 2. 安全設計

- **PKCE（RFC 7636）**：授權碼只能用發起登入的那一組 `code_verifier` 換取，攔截授權碼無效。實作以 RFC 7636 附錄 B 的測試向量驗證（`packages/core/test/unit/auth-pkce.test.mjs`）。
- **state**：回呼的 `state` 必須與發起時相同，防止他人把自己的授權碼塞進本機回呼。
- **本機回呼只綁定 127.0.0.1**，不接受其他主機。回呼位址固定為 53682，因為授權伺服器要求 `redirect_uri` 完全相符。
- **不使用 client secret**：桌面程式無法保密 secret，因此採公開客戶端。
- **權杖加密保存**：沿用設定檔金鑰的 `safeStorage`；無法加密時拒絕寫入，不以明文保存。
- **不撤銷伺服器端授權**：登出只刪除本機資料，以免影響使用者在其他裝置上的登入。

## 3. 本機測試

- 單元測試：`packages/core/test/unit/auth-pkce.test.mjs`（11 項）。
- 端到端測試：`apps/desktop/scripts/auth-e2e.cjs`。以真的 Electron 主程序、真的按鈕操作、真的本機回呼與瀏覽器重新導向、真的 PKCE 驗證運行，授權伺服器為本機假伺服器（模擬 `/oauth/register`、`/oauth/authorize`、`/oauth/token`）。執行：`npx electron scripts/auth-e2e.cjs`（需先 `npm run build`）。結果 10/10 通過。

開發版可設定環境變數 `JUDGE_SKIP_AUTH=1` 略過閘門（只在未打包的開發版生效）。`JUDGE_AUTH_BASE` 可改為測試用授權伺服器網址。

## 4. 尚未完成（需要確認與設定）

1. **Google 登入（授權頁）**：目前授權頁（judge-remote-mcp 的 `functions/src/authPage.ts`）只有 Email 與密碼登入。要支援 Google，需要：
   - 在 Firebase 專案 `judge-remote-mcp-2026` 的 Authentication 啟用 Google 提供者（主控台設定，需要專案擁有者操作）；
   - 授權頁加入 Google 登入按鈕，並在頁面載入時檢查目前 Google 登入狀態：已登入則直接放行並導回本機回呼，不再要求操作。
   這兩項屬於部署中的服務，變更前需要確認。
2. **回呼埠 53682 的占用**：若使用者同時開啟兩個程式實例，第二個會回報埠被占用。目前以單一實例鎖避免，但其他程式占用時仍會失敗。
3. **macOS／Linux 的 safeStorage**：Linux 沒有 secret service 時無法加密保存，登入會被拒絕並說明原因。尚未在實機驗證。

## 5. 相關檔案

- 核心工具：`packages/core/src/auth/pkce.ts`
- 雲端資料層：`apps/desktop/src/main/data/cloud/authRepo.ts`
- 本地資料層：`apps/desktop/src/main/data/local/authStore.ts`
- 服務：`apps/desktop/src/main/services/authService.ts`
- IPC：`apps/desktop/src/main/ipc/authIpc.ts`；預載：`apps/desktop/src/main/preload.ts`
- 畫面：`apps/desktop/src/renderer/js/controllers/auth.js`、`js/views/authView.js`、`js/templates/authGatePage.js`、`css/auth.css`
