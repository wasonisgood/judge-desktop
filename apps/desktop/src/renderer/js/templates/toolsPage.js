// 頁面模板：toolsPage（工具）。把工具性的功能收在一處：每一項都是獨立的子頁，與研究流程的頁面分開。
(function (JR) {
  'use strict';
  JR.templates.toolsPage = `
      <section class="page" id="page-tools">
        <h1>工具</h1>
        <p class="lead">獨立的工具，不屬於研究流程。每一項都可以單獨使用，輸入與結果仍會保存在「檔案」。</p>
        <ul class="entries">
          <li>
            <button class="entry" data-go="crawl">
              <span class="entry-title">文本擷取</span>
              <span class="entry-desc">依序執行五步：取得清單、取得文本、歷審、歷審文本、確定判決。輸出檔案放在輸入檔所在的資料夾。</span>
            </button>
          </li>
          <li>
            <button class="entry" data-go="chart">
              <span class="entry-title">量化圖表</span>
              <span class="entry-desc">讀取 Excel 結果檔，繪製長條圖、堆疊條圖、小提琴圖、交叉表與格狀地圖。只使用檔案內的資料。</span>
            </button>
          </li>
        </ul>
      </section>
`;
})(window.JR);
