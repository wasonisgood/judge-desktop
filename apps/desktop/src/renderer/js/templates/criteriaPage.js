// 頁面模板：criteriaPage（納入／排除核查）。流程：候選判決 → 標準 → 執行前規劃（確認後才執行）→ 結果與比較。
(function (JR) {
  'use strict';
  JR.templates.criteriaPage = `
      <section class="page" id="page-criteria">
        <h1>納入／排除核查</h1>
        <p class="lead">依你定義的納入與排除標準，逐案判斷候選判決。程式判斷只看關鍵字；AI 判斷的依據必須能在判決原文中逐字找到，找不到的一律視為無效。</p>

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
        <p class="hint"><strong>程式判斷</strong>：只看判決原文是否出現你指定的關鍵字（任一或全部），不呼叫 AI。</p>
        <p class="hint"><strong>AI 判斷（標準查核 AI）</strong>：AI 依你定義的納入或排除標準，逐案判斷判決是否符合，回覆「符合、不符合、無法判斷」。每個判斷都必須附上判決原文中逐字存在的依據；找不到逐字依據的判斷會標示為「依據無效」並改為無法判斷。</p>
        <p class="hint">納入標準不成立、或排除標準成立，該案即排除；有無法判斷的，列為需人工檢視。</p>
        <div class="crit-rows" id="critRows"></div>
        <div class="actions">
          <button class="btn" type="button" id="critAdd">新增標準</button>
        </div>

        <h2>三、執行前規劃</h2>
        <div class="actions">
          <button class="btn" type="button" id="critPlan" disabled>規劃執行</button>
          <select id="critAi" class="ai-source" title="AI 來源">
            <option value="auto">AI：自動（本地優先）</option>
            <option value="local">AI：本地模型</option>
            <option value="cloud">AI：雲端</option>
          </select>
          <button class="btn primary" type="button" id="critRun" disabled>確認執行</button>
          <p class="hint">只有含「AI 判斷」的標準會呼叫 AI；全部是程式判斷時不呼叫 AI。</p>
        </div>
        <div class="crit-plan" id="critPlanBox" hidden></div>
        <p class="status" id="critRunStatus" role="status"></p>

        <h2>四、結果</h2>
        <div class="actions">
          <label class="field crit-pick">
            <span>查看第幾次</span>
            <select id="critRunSel"></select>
          </label>
          <label class="field crit-pick">
            <span>與第幾次比較</span>
            <select id="critCompareSel"></select>
          </label>
          <button class="btn" type="button" id="critCompare" disabled>比較</button>
          <button class="btn" type="button" id="critReview" disabled>AI 檢閱是否需要重新檢索</button>
          <button class="btn" type="button" id="critExport" disabled>匯出 Excel</button>
        </div>
        <p class="hint">AI 檢閱只把結果摘要（候選數、各標準的判定次數）交給 AI，不會傳送判決全文；按下才會呼叫 AI。</p>
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
