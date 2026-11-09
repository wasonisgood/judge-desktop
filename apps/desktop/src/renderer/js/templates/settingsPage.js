// 頁面模板：settingsPage（由原 index.html 逐字拆出，DOM 結構不變）。
(function (JR) {
  'use strict';
  JR.templates.settingsPage = `
      <section class="page" id="page-settings">
        <h1>設定</h1>
        <section class="local-mods" aria-labelledby="localModTitle">
          <h2 id="localModTitle">本地模組（可選）</h2>
          <p class="hint">本地模組在獨立的「本地模組安裝精靈」視窗中安裝，包含檢查、選擇方案、同意與註冊。完成前，主畫面功能照常使用。</p>
          <p class="status" id="localAiSummary" role="status">讀取中…</p>
          <p class="status" id="localCrawlSummary" role="status"></p>
          <p class="status" id="updaterSummary" role="status"></p>
          <div class="actions"><button class="btn primary" type="button" id="openWizard">開啟本地模組安裝精靈</button><button class="btn" type="button" id="openDiag">排除問題與模組更新</button></div>
        </section>
        <form class="form" id="settingsForm">
          <h2>AI 服務</h2>
          <label class="field">
            <span>驗證方式</span>
            <select id="setAuthMode">
              <option value="apiKey">使用我自己的 API 金鑰</option>
              <option value="federation">工作負載身分聯合（由提供者代為連線）</option>
            </select>
          </label>
          <label class="field">
            <span>服務類型</span>
            <select id="setProvider">
              <option value="anthropic">Anthropic（Claude）</option>
              <option value="openai-compatible">OpenAI 相容的服務</option>
            </select>
          </label>
          <div id="fedFields" hidden>
@@WIF_GUIDE@@
            <label class="field">
              <span>組織 ID</span>
              <input id="setFedOrg" autocomplete="off" placeholder="例如 xxxxxxxx-xxxx-…">
            </label>
            <label class="field">
              <span>聯合規則 ID</span>
              <input id="setFedRule" autocomplete="off" placeholder="fdrl_…">
            </label>
            <label class="field">
              <span>服務帳號 ID</span>
              <input id="setFedSvc" autocomplete="off" placeholder="svac_…">
            </label>
            <label class="field">
              <span>工作區 ID（規則涵蓋多個工作區時才需要）</span>
              <input id="setFedWorkspace" autocomplete="off" placeholder="wrkspc_…（選填）">
            </label>
            <label class="field">
              <span>身分憑證檔案路徑</span>
              <input id="setFedFile" autocomplete="off" placeholder="例如 C:\Users\你\identity.jwt">
            </label>
          </div>
          <label class="field">
            <span>服務網址</span>
            <input id="setBaseUrl" autocomplete="off">
          </label>
          <label class="field">
            <span>模型名稱</span>
            <input id="setModel" autocomplete="off">
          </label>
          <label class="field" id="keyField">
            <span>API 金鑰 <small id="keyState"></small></span>
            <input id="setKey" type="password" autocomplete="new-password" placeholder="要更換時再輸入；不輸入則保留原金鑰">
          </label>
          <div class="actions">
            <button class="btn primary" type="submit">儲存</button>
            <button class="btn" type="button" id="setTest">測試連線</button>
            <button class="btn danger" type="button" id="setClear">清除金鑰</button>
          </div>
          <p class="status" id="setStatus" role="status"></p>

          <h2>一般</h2>
          <label class="field">
            <span>判決搜尋結果快取天數</span>
            <input id="setCacheDays" type="number" min="1" max="90" value="7">
          </label>
          <p class="hint">法條沿革與法名確認會永久保存；現行法規全文保存 30 天。判決內頁永久保存。</p>
          <div class="actions">
            <button class="btn" type="button" id="cacheClear">清除本機快取</button>
            <button class="btn" type="button" id="openUpdater">檢查更新</button>
          </div>
        </form>
        <section class="account" aria-labelledby="accountTitle">
          <h2 id="accountTitle">帳號</h2>
          <p class="hint">目前以授權帳號登入。登出只會清除這台電腦上的登入資料。</p>
          <div class="actions"><button class="btn" type="button" id="authSignOut">登出</button></div>
        </section>
        <p class="hint">金鑰只保存在這台電腦，並以系統的加密機制保護。本程式不會把金鑰傳給其他服務。</p>
        <p class="hint" id="versionInfo"></p>
      </section>
`;
})(window.JR);
