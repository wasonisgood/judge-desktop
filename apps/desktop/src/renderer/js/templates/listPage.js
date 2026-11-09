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
          <div class="actions">
            <button class="btn primary" type="submit" id="listRun">搜尋</button>
            <button class="btn" type="button" id="listExport" disabled>匯出 Excel</button>
            <button class="btn" type="button" id="listScreen" disabled>AI 篩選相關判決</button>
          </div>
          <div class="progress" id="listProgress" hidden><div class="bar"></div></div>
          <p class="status" id="listStatus" role="status"></p>
        </form>
        <label class="check" id="listShowAllWrap" hidden><input type="checkbox" id="listShowAll"><span>顯示不相關的判決</span></label>
        <p class="status" id="listScreenStatus" role="status"></p>
        <div class="table-wrap" id="listResult" hidden>
          <table class="table">
            <thead><tr><th>序號</th><th>裁判字號</th><th>裁判日期</th><th>案由</th><th>AI 判斷</th><th></th></tr></thead>
            <tbody id="listBody"></tbody>
          </table>
        </div>
      </section>
`;
})(window.JR);
