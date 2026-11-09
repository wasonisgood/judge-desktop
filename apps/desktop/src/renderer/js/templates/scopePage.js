// 頁面模板：scopePage（由原 index.html 逐字拆出，DOM 結構不變）。
(function (JR) {
  'use strict';
  JR.templates.scopePage = `
      <section class="page" id="page-scope">
        <h1>範圍整理表</h1>
        <p class="lead">輸入法規，每行一部。可以只寫法名，也可以寫到條、項、款，例如「民法第184條第1項」。法名需與全國法規資料庫的正式名稱相同。需要先在「設定」輸入 AI 金鑰。</p>
        <form class="form" id="scopeForm">
          <label class="field">
            <span>管轄區</span>
            <select id="scopeJurisdiction"></select>
          </label>
          <label class="field">
            <span>法規（每行一部）</span>
            <textarea id="scopeLines" rows="4" placeholder="例如：&#10;國家賠償法&#10;民法第184條第1項"></textarea>
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
              <span>每部法規最多筆數</span>
              <input id="scopeMax" type="number" min="1" max="100" value="30">
            </label>
          </div>
          <div class="actions">
            <select id="scopeAi" class="ai-source" title="AI 來源">
              <option value="auto">AI：自動（本地優先）</option>
              <option value="local">AI：本地模型</option>
              <option value="cloud">AI：雲端</option>
            </select>
            <button class="btn primary" type="submit" id="scopeRun">開始整理</button>
            <button class="btn" type="button" id="scopeXlsx" disabled>匯出 Excel</button>
            <button class="btn" type="button" id="scopeDocx" disabled>匯出 Word</button>
          </div>
          <div class="progress" id="scopeProgress" hidden><div class="bar"></div></div>
          <p class="status" id="scopeStatus" role="status"></p>
        </form>
        <div id="scopeResult"></div>
      </section>
`;
})(window.JR);
