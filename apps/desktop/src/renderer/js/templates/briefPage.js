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
            <span>案件類型（選填；提示 AI，並檢查判決字號是否相符）</span>
            <select id="briefCaseType">
              <option value="">不指定</option>
              <option value="民事">民事</option>
              <option value="刑事">刑事</option>
              <option value="行政">行政</option>
            </select>
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
              <option value="cloud" selected>AI：雲端</option>
            </select>
            <button class="btn primary" type="submit" id="briefRun" disabled>整理這則判決</button>
            <button class="btn" type="button" id="briefCancel" hidden>取消</button>
            <button class="btn" type="button" id="briefExport" disabled>匯出 Word</button>
            <button class="btn" type="button" id="briefExplain" disabled>查看處理流程</button>
          </div>
          <p class="status" id="briefStatus" role="status"></p>
        </form>
        <article class="reader" id="briefView" hidden></article>
        <section class="annotate" id="annSection" hidden>
          <h2>判決全文標注與註解</h2>
          <p class="hint">在全文上拖曳選取文字，即出現顏色工具列。標注只存在本機；全文變動時會標示為「需重新對位」，不會錯位。</p>
          <div class="annotate-bar">
            <button class="btn small" type="button" id="annLoad" disabled>載入全文</button>
            <label class="check"><input type="checkbox" id="annShowAi" checked> 顯示 AI 引文標注</label>
            <button class="btn small" type="button" id="annImportAi" disabled>加入 AI 引文標注</button>
            <button class="btn small" type="button" id="annExport" disabled>下載本案 Word</button>
            <button class="btn small" type="button" id="annExportMany" disabled>合併匯出勾選案件</button>
            <span class="ann-count" id="annCount"></span>
          </div>
          <div class="ann-nav" id="annNav" hidden>
            <button class="btn small" type="button" id="annPrev">上一案</button>
            <span class="ann-nav-text" id="annNavText"></span>
            <button class="btn small" type="button" id="annNext">下一案</button>
          </div>
          <p class="status" id="annStatus" role="status"></p>
          <div class="annotate-layout">
            <div class="ann-reader-wrap">
              <div class="ann-toolbar" id="annToolbar" role="toolbar" hidden>
                <button type="button" class="ann-sw ann-yellow" data-color="yellow">事實</button>
                <button type="button" class="ann-sw ann-green" data-color="green">爭點</button>
                <button type="button" class="ann-sw ann-pink" data-color="pink">主文</button>
                <button type="button" class="ann-sw ann-blue" data-color="blue">理由</button>
                <span class="ann-sep"></span>
                <button type="button" class="btn small primary" data-mode="highlight" aria-pressed="true">只畫螢光</button>
                <button type="button" class="btn small" data-mode="highlight_note" aria-pressed="false">螢光並做筆記</button>
              </div>
              <div class="ann-reader" id="annReader"></div>
            </div>
            <aside class="ann-side">
              <div class="ann-sync">
                <h3>雲端同步</h3>
                <p class="hint">只同步標注、註解、四色名稱與判決的案號／標題等顯示資訊，不含判決全文與 AI 金鑰。</p>
                <p class="status" id="annSyncStatus" role="status"></p>
                <div class="actions"><button class="btn small primary" type="button" id="annSyncNow" disabled>立即同步</button></div>
              </div>
              <div class="ann-past">
                <h3>過去筆記 <span id="annPastCount"></span></h3>
                <ul class="ann-notes" id="annPastList"></ul>
              </div>
              <details class="ann-labels" id="annLabels">
                <summary>顏色名稱（可自訂）</summary>
                <label class="field"><span>黃</span><input id="annLabel-yellow" maxlength="12"></label>
                <label class="field"><span>綠</span><input id="annLabel-green" maxlength="12"></label>
                <label class="field"><span>粉紅</span><input id="annLabel-pink" maxlength="12"></label>
                <label class="field"><span>藍</span><input id="annLabel-blue" maxlength="12"></label>
                <div class="actions">
                  <button class="btn small primary" type="button" id="annLabelsSave">儲存名稱</button>
                  <button class="btn small" type="button" id="annLabelsReset">還原預設</button>
                </div>
              </details>
              <div class="ann-editor" id="annEditor" hidden></div>
              <h3>註解 <span id="annNoteCount"></span></h3>
              <ul class="ann-notes" id="annNotes"></ul>
              <div id="annReanchorBox" hidden>
                <h3>需重新對位</h3>
                <ul class="ann-notes" id="annReanchor"></ul>
              </div>
            </aside>
          </div>
        </section>
      </section>
`;
})(window.JR);
