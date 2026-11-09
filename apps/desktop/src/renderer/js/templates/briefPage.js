// 頁面模板：briefPage（由原 index.html 逐字拆出，DOM 結構不變）。
(function (JR) {
  'use strict';
  JR.templates.briefPage = `
      <section class="page" id="page-brief">
        <h1>單一判決精讀</h1>
        <p class="lead">可以輸入判決名稱、關鍵字或縮寫（例如「高院 戒嚴」）。先列出候選，再選定一則，系統只精讀這一則。</p>
        <form class="form" id="briefFindForm">
          <label class="field">
            <span>管轄區</span>
            <select id="briefJurisdiction"></select>
          </label>
          <label class="field">
            <span>判決名稱、關鍵字或縮寫</span>
            <input id="briefQuery" required placeholder="例如：高院 戒嚴、回復原狀" autocomplete="off">
          </label>
          <div class="actions">
            <button class="btn" type="submit" id="briefFind">查找候選</button>
          </div>
          <p class="status" id="briefFindStatus" role="status"></p>
        </form>
        <p class="picked" id="briefPickedBar">已選定：<strong id="briefPicked">尚未選定</strong></p>
        <div class="table-wrap" id="briefCandidates" hidden>
          <table class="table">
            <thead><tr><th>序號</th><th>裁判字號</th><th>裁判日期</th><th>案由</th><th></th></tr></thead>
            <tbody id="briefCandidateBody"></tbody>
          </table>
        </div>
        <form class="form" id="briefForm">
          <fieldset class="field brief-fields">
            <legend>要整理的欄位（勾選；可加入自訂欄位並寫說明）</legend>
            <div id="briefFieldList"></div>
            <div class="actions">
              <button class="btn small" type="button" id="briefFieldAdd">加入自訂欄位</button>
            </div>
            <p class="hint">只會整理勾選的欄位，並依列表順序排列。AI 不會整理未勾選的欄位。</p>
          </fieldset>
          <label class="field">
            <span>想了解的重點（選填）</span>
            <input id="briefFocus" placeholder="例如：爭點、事實認定、回復原狀的要件" autocomplete="off">
          </label>
          <label class="field">
            <span>篇幅</span>
            <select id="briefLength">
              <option value="半頁">半頁</option>
              <option value="約 1 頁" selected>約 1 頁</option>
              <option value="約 2 頁">約 2 頁</option>
              <option value="約 3 頁">約 3 頁</option>
            </select>
          </label>
          <p class="hint">精讀內容全部由 AI 整理，請先在「設定」輸入 AI 金鑰。</p>
          <div class="actions">
            <select id="briefAi" class="ai-source" title="AI 來源">
              <option value="auto">AI：自動（本地優先）</option>
              <option value="local">AI：本地模型</option>
              <option value="cloud">AI：雲端</option>
            </select>
            <button class="btn primary" type="submit" id="briefRun" disabled>整理這則判決</button>
            <button class="btn" type="button" id="briefExport" disabled>匯出 Word</button>
          </div>
          <p class="status" id="briefStatus" role="status"></p>
        </form>
        <article class="reader" id="briefView" hidden></article>
      </section>
`;
})(window.JR);
