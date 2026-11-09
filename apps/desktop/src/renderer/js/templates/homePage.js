// 頁面模板：homePage（由原 index.html 逐字拆出，DOM 結構不變）。
(function (JR) {
  'use strict';
  JR.templates.homePage = `
      <section class="page active" id="page-home">
        <h1>司法院裁判研究</h1>
        <p class="lead">搜尋司法院公開的裁判書，整理成表格，或精讀單一判決。三個頁面可以接續使用：前一頁的結果會保留在檔案中。</p>
        <ul class="entries">
          <li>
            <button class="entry" data-go="list">
              <span class="entry-title">判決列表</span>
              <span class="entry-desc">輸入關鍵字，查出相關判決，可匯出 Excel。</span>
            </button>
          </li>
          <li>
            <button class="entry" data-go="scope">
              <span class="entry-title">標編碼標注工序</span>
              <span class="entry-desc">輸入關鍵字或法規（可加條、項、款），列出判決，並依勾選的分析欄位由 AI 編碼；每格附判決原文的逐字依據，對不上的標示為待覆核。</span>
            </button>
          </li>
          <li>
            <button class="entry" data-go="brief">
              <span class="entry-title">單一判決精讀</span>
              <span class="entry-desc">輸入判決名稱或關鍵字，從候選中選定一則，由 AI 整理成文書，匯出 Word。</span>
            </button>
          </li>
          <li>
            <button class="entry" data-go="files">
              <span class="entry-title">檔案</span>
              <span class="entry-desc">保存過的結果。可加星號、封存、移入垃圾桶，或重新開啟。</span>
            </button>
          </li>
          <li>
            <button class="entry" data-go="settings">
              <span class="entry-title">AI 設定</span>
              <span class="entry-desc">設定 AI 服務與金鑰。金鑰只保存在這台電腦。</span>
            </button>
          </li>
        </ul>
      </section>
`;
})(window.JR);
