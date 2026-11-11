// 頁面模板：criteriaPage（納入／排除核查）。流程：候選判決 → 標準（一句話描述）→ 執行前規劃（確認後才執行）→ 結果。
(function (JR) {
  'use strict';
  JR.templates.criteriaPage = `
      <section class="page" id="page-criteria">
        <h1>納入／排除核查</h1>
        <p class="lead">先選定候選判決，再用一句話描述納入與排除的條件。AI 判斷的依據必須能在判決原文中逐字找到，找不到的一律視為無效。</p>

        <h2>一、候選判決</h2>
        <form class="form" id="critSourceForm">
          <label class="field">
            <span>來源（已保存的判決列表或範圍整理）</span>
            <select id="critSource"></select>
          </label>
          <div class="actions">
            <button class="btn primary" type="submit" id="critFetch">讀取候選判決</button>
            <button class="btn" type="button" id="critCancel" hidden>取消</button>
            <button class="btn" type="button" id="critRefresh">重新整理來源</button>
          </div>
          <p class="status" id="critFetchStatus" role="status"></p>
        </form>
        <details class="crit-rerun" id="critRerun">
          <summary>以新關鍵字重新檢索</summary>
          <form class="form" id="critSearchForm">
            <div class="row">
              <label class="field">
                <span>新的關鍵字</span>
                <input id="critQuery" placeholder="例如：消費者 買賣 退貨" autocomplete="off">
              </label>
              <label class="field">
                <span>最多筆數</span>
                <input id="critMax" type="number" min="1" max="100" value="20">
              </label>
            </div>
            <div class="actions">
              <button class="btn" type="submit" id="critSearch">重新檢索並讀取</button>
            </div>
            <p class="hint">重新檢索的結果會另外保存：執行核查後成為新的一次，可與先前的結果比較。</p>
          </form>
        </details>

        <h2>二、標準</h2>
        <form class="form crit-nl" id="critNlForm">
          <label class="field">
            <span>用一句話描述納入或排除的條件</span>
            <textarea id="critNlText" rows="2" autocomplete="off" placeholder="例如：原告是消費者，排除判決書內提到『和解』的案件"></textarea>
          </label>
          <div class="actions">
            <button class="btn primary" type="submit" id="critNlRun">整理成標準</button>
            <span class="hint">只輸入關鍵字（例如「消費者 買賣」）時，會直接當作一條關鍵字標準。</span>
          </div>
          <p class="status" id="critNlStatus" role="status"></p>
        </form>
        <div class="crit-rows" id="critRows"></div>
        <div class="actions">
          <button class="btn" type="button" id="critAdd">手動新增標準</button>
          <button class="btn" type="button" id="critAiSuggest">AI 依候選判決建議標準</button>
        </div>
        <p class="hint">AI 建議只送出候選判決的字號與判決開頭約 150 字（通常含案由），不送整篇全文；建議的標準要你確認後才會用於核查。</p>
        <div class="actions crit-presets">
          <label class="field crit-pick">
            <span>我的標準組合</span>
            <select id="critPresetSel"></select>
          </label>
          <button class="btn" type="button" id="critPresetLoad">載入</button>
          <button class="btn danger" type="button" id="critPresetDel">刪除</button>
          <label class="field crit-pick">
            <span>儲存目前標準為</span>
            <input id="critPresetName" placeholder="例如：消費者買賣" autocomplete="off">
          </label>
          <button class="btn" type="button" id="critPresetSave">儲存</button>
        </div>
        <p class="status" id="critPresetStatus" role="status"></p>
        <p class="hint"><strong>AI 判斷</strong>：AI 依標準逐案判斷符合、不符合或無法判斷，每個判斷都要附上判決原文逐字依據；找不到依據的判斷會標示為無效並改為無法判斷。<strong>程式判斷</strong>：只看判決原文是否出現指定關鍵字，不呼叫 AI。</p>

        <h2>三、執行</h2>
        <div class="actions">
          <button class="btn" type="button" id="critPlan" disabled>規劃執行</button>
          <select id="critAi" class="ai-source" title="AI 來源">
            <option value="auto">AI：自動（本地優先）</option>
            <option value="local">AI：本地模型</option>
            <option value="cloud" selected>AI：雲端</option>
          </select>
          <button class="btn primary" type="button" id="critRun" disabled>確認執行</button>
        </div>
        <p class="hint">只有含「AI 判斷」的標準會呼叫 AI；全部是程式判斷時不呼叫 AI。納入標準不成立、或排除標準成立，該案即排除；有無法判斷的，列為需人工檢視。</p>
        <div class="crit-plan" id="critPlanBox" hidden></div>
        <p class="status" id="critRunStatus" role="status"></p>

        <h2>四、結果</h2>
        <div class="actions">
          <label class="field crit-pick">
            <span>查看第幾次</span>
            <select id="critRunSel"></select>
          </label>
          <button class="btn" type="button" id="critExport" disabled>匯出 Excel</button>
        </div>
        <details class="crit-advanced">
          <summary>進階：比較兩次結果、AI 檢閱是否需要重新檢索</summary>
          <div class="actions">
            <label class="field crit-pick">
              <span>與第幾次比較</span>
              <select id="critCompareSel"></select>
            </label>
            <button class="btn" type="button" id="critCompare" disabled>比較</button>
            <button class="btn" type="button" id="critReview" disabled>AI 檢閱是否需要重新檢索</button>
          </div>
          <p class="hint">AI 檢閱只把結果摘要（候選數、各標準的判定次數）交給 AI，不會傳送判決全文；按下才會呼叫 AI。</p>
        </details>
        <div class="crit-suggest" id="critSuggest" role="status" hidden></div>
        <div class="crit-compare" id="critCompareBox" hidden></div>
        <div class="table-wrap" id="critResult" hidden>
          <table class="table crit-table">
            <thead id="critHead"></thead>
            <tbody id="critBody"></tbody>
          </table>
        </div>
        <p class="status" id="critResultStatus" role="status"></p>
      </section>
`;
})(window.JR);
