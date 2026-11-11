// 頁面模板：listPage（由原 index.html 逐字拆出，DOM 結構不變）。
(function (JR) {
  'use strict';
  JR.templates.listPage = `
      <section class="page" id="page-list">
        <h1>判決列表</h1>
        <form class="form" id="listForm">
          <label class="field">
            <span>管轄區</span>
            <select id="listJurisdiction"></select>
          </label>
          <label class="field">
            <span>關鍵字</span>
            <input id="listKeyword" required placeholder="例如：戒嚴、回復原狀" autocomplete="off">
          </label>
          <label class="field">
            <span>相關法規（選填，智慧搜尋時 AI 會先讀入現行條文與沿革）</span>
            <input id="listStatute" placeholder="例如：國家賠償法" autocomplete="off">
          </label>
          <div class="row">
            <label class="field">
              <span>最多筆數</span>
              <input id="listMax" type="number" min="1" max="100" value="20">
            </label>
            <label class="field">
              <span>法院代碼（選填）</span>
              <input id="listCourt" placeholder="留空表示全部法院" autocomplete="off">
            </label>
          </div>
          <label class="check">
            <input type="checkbox" id="listFull">
            <span>逐筆讀取全文（較慢，匯出時會附上主文）</span>
          </label>
          <label class="check">
            <input type="checkbox" id="listSmart">
            <span>智慧搜尋：用一句話描述範圍，AI 會自動調整關鍵字（最多 3 輪，未設定 AI 時只查一次）</span>
          </label>
          <div class="actions">
            <button class="btn primary" type="submit" id="listRun">搜尋</button>
            <button class="btn" type="button" id="listCancel" hidden>取消</button>
            <button class="btn" type="button" id="listExport" disabled>匯出 Excel</button>
            <select id="listAi" class="ai-source" title="AI 來源">
              <option value="auto">AI：自動（本地優先）</option>
              <option value="local">AI：本地模型</option>
              <option value="cloud" selected>AI：雲端</option>
            </select>
            <button class="btn" type="button" id="listScreen" disabled>AI 篩選相關判決</button>
            <button class="btn" type="button" id="listExplain" disabled>查看處理流程</button>
          </div>
          <div class="progress" id="listProgress" hidden><div class="bar"></div></div>
          <p class="status" id="listStatus" role="status"></p>
          <div class="clarify" id="listClarify" hidden></div>
        </form>
        <label class="check" id="listShowAllWrap" hidden><input type="checkbox" id="listShowAll"><span>顯示不相關的判決</span></label>
        <p class="status" id="listScreenStatus" role="status"></p>
        <div class="table-wrap" id="listResult" hidden>
          <table class="table">
            <thead><tr><th>序號</th><th>裁判字號</th><th>裁判日期</th><th>案由</th><th>AI 判斷</th><th></th></tr></thead>
            <tbody id="listBody"></tbody>
          </table>
        </div>
        <section class="manual-list" aria-labelledby="manualTitle">
          <h2 id="manualTitle">手動輸入判決</h2>
          <p class="hint">每行貼上一則判決的網址或判決 ID（例如司法院判決頁網址，或 TPSV_103_2434_20141119）。系統會逐則取得基本資料，產生列表；可匯出 Excel，也會存入「檔案」。</p>
          <form class="form" id="manualForm">
            <label class="field">
              <span>判決網址或 ID（每行一則）</span>
              <textarea id="manualIds" rows="4" placeholder="https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&amp;id=…"></textarea>
            </label>
            <div class="actions">
              <button class="btn primary" type="submit" id="manualRun">產生列表</button>
            </div>
            <p class="status" id="manualStatus" role="status"></p>
          </form>
        </section>
      </section>
`;
})(window.JR);
