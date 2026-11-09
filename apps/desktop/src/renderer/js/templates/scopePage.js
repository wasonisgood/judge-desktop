// 頁面模板：scopePage（標編碼標注工序；內部識別碼仍為 scope）。
(function (JR) {
  'use strict';
  JR.templates.scopePage = `
      <section class="page" id="page-scope">
        <h1>標編碼標注工序</h1>
        <p class="lead">輸入關鍵字（可用一句話描述範圍）或法規（每行一部），列出判決，並依勾選的分析欄位由 AI 編碼。每個欄位都附判決原文的逐字依據；依據對不上的欄位會標示為待覆核。需要先在「設定」輸入 AI 金鑰。</p>
        <form class="form" id="scopeForm">
          <label class="field">
            <span>管轄區</span>
            <select id="scopeJurisdiction"></select>
          </label>
          <label class="field">
            <span>關鍵字（選填，可用一句話描述範圍）</span>
            <input id="scopeKeyword" placeholder="例如：國家賠償 戒嚴 回復原狀" autocomplete="off">
          </label>
          <label class="field">
            <span>相關法規（選填，與關鍵字併用；智慧搜尋時 AI 會先讀入現行條文與沿革）</span>
            <input id="scopeRelated" placeholder="例如：國家賠償法" autocomplete="off">
          </label>
          <label class="check">
            <input type="checkbox" id="scopeSmart">
            <span>智慧搜尋：AI 會自動調整關鍵字（最多 3 輪，未設定 AI 時只查一次）</span>
          </label>
          <label class="field">
            <span>法規（選填，每行一部；可以只寫法名，也可以寫到條、項、款，例如「民法第184條第1項」。法名需與全國法規資料庫的正式名稱相同）</span>
            <textarea id="scopeLines" rows="3" placeholder="例如：&#10;國家賠償法&#10;民法第184條第1項"></textarea>
          </label>
          <div class="row">
            <label class="field">
              <span>起始年（西元，選填）</span>
              <input id="scopeFrom" type="number" min="1945" max="2100" placeholder="例如 2000">
            </label>
            <label class="field">
              <span>結束年（西元，選填）</span>
              <input id="scopeTo" type="number" min="1945" max="2100" placeholder="例如 2026">
            </label>
            <label class="field">
              <span>最多筆數（每個關鍵字或法規）</span>
              <input id="scopeMax" type="number" min="1" max="100" value="30">
            </label>
          </div>
          <fieldset class="field brief-fields">
            <legend>分析欄位（勾選；可加入自訂欄位、調整順序）</legend>
            <div id="scopeFieldList"></div>
            <div class="actions">
              <button class="btn small" type="button" id="scopeFieldAdd">加入自訂欄位</button>
            </div>
            <p class="hint">只會編碼勾選的欄位，並依列表順序排列。每個欄位的依據都必須是判決原文的逐字引用。</p>
          </fieldset>
          <label class="check">
            <input type="checkbox" id="scopeAiOn" checked>
            <span>啟用 AI 分析（逐案編碼與綜合；關閉時只做傳統篩選，不需要 AI）</span>
          </label>
          <div class="actions">
            <select id="scopeAi" class="ai-source" title="AI 來源">
              <option value="auto">AI：自動（本地優先）</option>
              <option value="local">AI：本地模型</option>
              <option value="cloud">AI：雲端</option>
            </select>
            <button class="btn primary" type="submit" id="scopeRun">開始整理</button>
            <button class="btn" type="button" id="scopeCancel" hidden>取消</button>
            <button class="btn" type="button" id="scopeXlsx" disabled>匯出 Excel</button>
            <button class="btn" type="button" id="scopeDocx" disabled>匯出 Word</button>
            <button class="btn" type="button" id="scopeExplain" disabled>查看處理流程</button>
          </div>
          <div class="progress" id="scopeProgress" hidden><div class="bar"></div></div>
          <p class="status" id="scopeStatus" role="status"></p>
          <div class="clarify" id="scopeClarify" hidden></div>
        </form>
        <div id="scopeResult"></div>
      </section>
`;
})(window.JR);
