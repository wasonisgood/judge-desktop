// 頁面模板：settingsPage（設定頁）。依本專案的版面語言：紙色底、襯線標題、分節列與朱色印章序號。
// 精簡為四節：帳號、AI 服務、模組、預設值；進階選項收合，聯合驗證的圖解放在進階內。
(function (JR) {
  'use strict';
  JR.templates.settingsPage = `
      <section class="page" id="page-settings">
        <h1>設定</h1>
        <p class="lead">帳號、AI 服務、模組與預設值。金鑰與登入資料只保存在這台電腦。</p>

        <section class="set-sec" aria-labelledby="secAccount">
          <h2 id="secAccount"><span class="set-no">壹</span>帳號</h2>
          <div class="set-row">
            <div class="set-label"><strong>授權帳號</strong><span class="set-desc" id="authSummary">讀取中…</span></div>
            <div class="set-ctl"><button class="btn" type="button" id="authSignOut">登出</button></div>
          </div>
        </section>

        <section class="set-sec" aria-labelledby="secAi">
          <h2 id="secAi"><span class="set-no">貳</span>AI 服務</h2>
          <form class="set-form" id="settingsForm">
            <div class="set-row">
              <div class="set-label"><strong>服務</strong><span class="set-desc">Anthropic 或 OpenAI 相容的服務</span></div>
              <div class="set-ctl">
                <select id="setProvider">
                  <option value="anthropic">Anthropic（Claude）</option>
                  <option value="openai-compatible">OpenAI 相容的服務</option>
                </select>
              </div>
            </div>
            <div class="set-row">
              <div class="set-label"><strong>驗證方式</strong><span class="set-desc">使用自己的金鑰，或由提供者代為連線</span></div>
              <div class="set-ctl">
                <select id="setAuthMode">
                  <option value="apiKey">我自己的 API 金鑰</option>
                  <option value="federation">工作負載身分聯合</option>
                </select>
              </div>
            </div>
            <div class="set-row" id="keyField">
              <div class="set-label"><strong>API 金鑰</strong><span class="set-desc">要更換時再輸入；不輸入則保留原金鑰 <small id="keyState"></small></span></div>
              <div class="set-ctl set-ctl-wide">
                <input id="setKey" type="password" autocomplete="new-password" placeholder="輸入新的金鑰">
                <button class="btn danger small" type="button" id="setClear">清除</button>
              </div>
            </div>
            @@FED_PANEL@@
            <details class="set-adv">
              <summary>進階設定</summary>
              <div class="set-row">
                <div class="set-label"><strong>服務網址</strong></div>
                <div class="set-ctl set-ctl-wide"><input id="setBaseUrl" autocomplete="off"></div>
              </div>
              <div class="set-row">
                <div class="set-label"><strong>模型名稱</strong></div>
                <div class="set-ctl set-ctl-wide"><input id="setModel" autocomplete="off"></div>
              </div>
            </details>
            <div class="actions">
              <button class="btn primary" type="submit">儲存</button>
              <button class="btn" type="button" id="setTest">測試連線</button>
            </div>
            <p class="status" id="setStatus" role="status"></p>
          </form>
        </section>

        <section class="set-sec" aria-labelledby="secMods">
          <h2 id="secMods"><span class="set-no">參</span>模組</h2>
          <div class="set-row">
            <div class="set-label"><strong>本地 AI</strong><span class="set-desc" id="localAiSummary" role="status">讀取中…</span></div>
            <div class="set-ctl">
              <label class="set-switch" title="開啟時，已安裝的本地模型會優先使用">
                <input type="checkbox" id="setLocalAi">
                <span class="switch"><span class="knob"></span></span>
                <span class="set-switch-text">使用本地模型</span>
              </label>
              <button class="btn small" type="button" id="openWizard">安裝或管理</button>
            </div>
          </div>
          <div class="set-row">
            <div class="set-label"><strong>量化圖表</strong><span class="set-desc">小提琴圖、堆疊圖、交叉表與示意格狀地圖，讀取 Excel 結果檔</span></div>
            <div class="set-ctl">
              <label class="set-switch" title="開啟即安裝並啟用；關閉即移除（頁面隱藏）">
                <input type="checkbox" id="setChartModule">
                <span class="switch"><span class="knob"></span></span>
                <span class="set-switch-text">安裝並啟用</span>
              </label>
              <button class="btn small" type="button" id="chartRemove">移除模組</button>
            </div>
          </div>
          <div class="set-row">
            <div class="set-label"><strong>爬取模組</strong><span class="set-desc" id="localCrawlSummary" role="status"></span></div>
            <div class="set-ctl"><button class="btn small" type="button" id="openCrawl">管理</button></div>
          </div>
          <div class="set-row">
            <div class="set-label"><strong>爭點知識庫</strong><span class="set-desc" id="knowledgeSummary" role="status">讀取中…</span></div>
            <div class="set-ctl"><button class="btn small" type="button" id="knowledgeInstall">更新知識庫</button></div>
          </div>
          <div class="set-row">
            <div class="set-label"><strong>應用程式更新</strong><span class="set-desc" id="updaterSummary" role="status"></span></div>
            <div class="set-ctl"><button class="btn small" type="button" id="openUpdater">檢查更新</button></div>
          </div>
          <div class="set-row">
            <div class="set-label"><strong>排除問題</strong><span class="set-desc">檢查本地 AI 與連線狀態，並匯出報告</span></div>
            <div class="set-ctl"><button class="btn small" type="button" id="openDiag">開啟</button></div>
          </div>
        </section>

        <section class="set-sec" aria-labelledby="secDefaults">
          <h2 id="secDefaults"><span class="set-no">肆</span>預設值</h2>
          <div class="set-row">
            <div class="set-label"><strong>預設管轄區</strong><span class="set-desc" id="jurisdictionNote">搜尋、精讀與範圍整理預設使用的來源</span></div>
            <div class="set-ctl"><select id="setJurisdiction"></select></div>
          </div>
          <div class="set-row">
            <div class="set-label"><strong>每次最多筆數</strong></div>
            <div class="set-ctl"><input id="setMaxItems" type="number" min="1" max="100" value="20"></div>
          </div>
          <div class="set-row">
            <div class="set-label"><strong>搜尋結果快取天數</strong><span class="set-desc">法條沿革與法名確認永久保存；判決內頁永久保存</span></div>
            <div class="set-ctl">
              <input id="setCacheDays" type="number" min="1" max="90" value="7">
              <button class="btn small" type="button" id="cacheClear">清除快取</button>
            </div>
          </div>
        </section>

        <p class="hint">金鑰只保存在這台電腦，並以系統的加密機制保護。本程式不會把金鑰傳給其他服務。</p>
        <p class="hint" id="versionInfo"></p>
      </section>
`;
})(window.JR);
