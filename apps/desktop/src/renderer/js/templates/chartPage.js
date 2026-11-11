// 頁面模板：chartPage（量化圖表模組，issue #8）。模組未啟用時整個內容區隱藏，顯示安裝提示。
(function (JR) {
  'use strict';
  JR.templates.chartPage = `
      <section class="page" id="page-chart">
        <p class="back-link"><button class="btn small" type="button" data-go="tools">← 回工具</button></p>
        <h1>量化圖表</h1>
        <p class="lead">讀取本程式匯出或自備的 Excel 結果檔，繪製長條圖、堆疊條圖、小提琴圖、交叉表與示意格狀地圖。圖表只使用檔案內的資料，不連線司法院。</p>
        <p class="hint" id="chartOff" hidden>量化圖表模組尚未安裝。請到「設定」→「模組」開啟「量化圖表」。關閉後本頁會隱藏，其他功能不受影響。</p>
        <div id="chartBody">
          <div class="form">
            <section class="chart-sec" aria-labelledby="chartSecData">
              <h2 id="chartSecData">一、資料</h2>
              <div class="actions">
                <button class="btn" type="button" id="chartPick">選擇 Excel 檔…</button>
                <span class="hint" id="chartFile">尚未選擇檔案（.xlsx）</span>
              </div>
              <div class="row">
                <label class="field">
                  <span>工作表</span>
                  <select id="chartSheet" disabled></select>
                </label>
              </div>
              <div class="table-wrap" id="chartColumnsWrap" hidden>
                <table class="table">
                  <thead><tr><th>欄位</th><th>推斷型態</th><th>覆寫為</th></tr></thead>
                  <tbody id="chartColumns"></tbody>
                </table>
              </div>
            </section>

            <section class="chart-sec" aria-labelledby="chartSecChart">
              <h2 id="chartSecChart">二、圖表</h2>
              <div class="row">
                <label class="field">
                  <span>圖表類型</span>
                  <select id="chartType">
                    <option value="bar">長條圖（案由分布、案件分類 × 法院別）</option>
                    <option value="stacked">堆疊條圖（律師代理 × 終結情形、量刑結構）</option>
                    <option value="violin">小提琴圖（刑期分布，依罪名，含箱形圖）</option>
                    <option value="crosstab">交叉表（標的金額級距 × 律師代理）</option>
                    <option value="map">地圖（各地方法院律師代理率，縣市界）</option>
                  </select>
                </label>
                <label class="field">
                  <span>計數單位</span>
                  <select id="chartUnit">
                    <option value="judgments">裁判書數（依 ID 去重）</option>
                    <option value="rows">列數（依原始列）</option>
                  </select>
                </label>
                <label class="field">
                  <span>裁判書 ID 欄</span>
                  <select id="chartId"></select>
                </label>
              </div>
              <div class="row">
                <label class="field" data-field="category">
                  <span id="chartCategoryLabel">類別欄</span>
                  <select id="chartCategory"></select>
                </label>
                <label class="field" data-field="series">
                  <span id="chartSeriesLabel">分組欄</span>
                  <select id="chartSeries"></select>
                </label>
                <label class="field" data-field="value">
                  <span id="chartValueLabel">數值欄</span>
                  <select id="chartValue"></select>
                </label>
                <label class="field" data-field="amount">
                  <span>標的金額欄（自動分級）</span>
                  <select id="chartAmount"></select>
                </label>
              </div>
              <label class="check" data-field="percent">
                <input type="checkbox" id="chartPercent">
                <span>以百分比顯示（每列 100%）</span>
              </label>
              <div class="row">
                <label class="field">
                  <span>篩選欄（選填）</span>
                  <select id="chartFilterCol"></select>
                </label>
                <label class="field">
                  <span>允許的值（逗號分隔，留空不篩）</span>
                  <input id="chartFilterVals" type="text" placeholder="例如：臺北地方法院,臺中地方法院" autocomplete="off">
                </label>
                <label class="field">
                  <span>圖表標題（選填）</span>
                  <input id="chartTitle" type="text" maxlength="120" autocomplete="off">
                </label>
              </div>
              <div class="actions">
                <button class="btn primary" type="button" id="chartRun" disabled>繪製</button>
                <button class="btn" type="button" id="chartPng" disabled>匯出 PNG</button>
                <button class="btn" type="button" id="chartSvg" disabled>匯出 SVG</button>
                <button class="btn" type="button" id="chartDocx" disabled>匯出 Word</button>
              </div>
              <p class="status" id="chartStatus" role="status"></p>
              <ul class="hint" id="chartWarnings" hidden></ul>
            </section>
          </div>
          <div id="chartOutput" class="chart-output"></div>
        </div>
      </section>
`;
})(window.JR);
