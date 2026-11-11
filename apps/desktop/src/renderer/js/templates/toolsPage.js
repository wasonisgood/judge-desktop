// 頁面模板：toolsPage（工具）。把工具性的功能收在一處：每一項都是獨立的子頁，與研究流程的頁面分開。
(function (JR) {
  'use strict';
  JR.templates.toolsPage = `
      <section class="page" id="page-tools">
        <h1>工具</h1>
        <p class="lead">獨立的工具，不屬於研究流程。每一項都可以單獨使用，輸入與結果仍會保存在「檔案」。</p>
        <ul class="entries">
          <li>
            <button class="entry" data-go="list">
              <span class="entry-title">查詢</span>
              <span class="entry-desc">輸入關鍵字，查出司法院的相關判決，可匯出 Excel。也可用一句話描述，由 AI 整理關鍵字。</span>
            </button>
          </li>
          <li>
            <button class="entry" data-go="criteria">
              <span class="entry-title">納入排除</span>
              <span class="entry-desc">以候選判決為基礎，用一句話描述納入與排除標準，逐案核查（同時也在研究流程中）。</span>
            </button>
          </li>
          <li>
            <button class="entry" data-go="brief">
              <span class="entry-title">判決文本解釋</span>
              <span class="entry-desc">選定一則判決，由 AI 整理成文書，並可在全文上標注、加註解。</span>
            </button>
          </li>
          <li>
            <button class="entry" data-go="files">
              <span class="entry-title">匯入判決清單</span>
              <span class="entry-desc">在「檔案」頁匯入任何常見格式的判決清單（Excel、CSV、Word、PDF、TXT），AI 自動判斷欄位。</span>
            </button>
          </li>
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
