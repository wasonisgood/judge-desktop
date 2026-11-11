// 頁面模板：filesPage（由原 index.html 逐字拆出，DOM 結構不變）。
(function (JR) {
  'use strict';
  JR.templates.filesPage = `
      <section class="page" id="page-files">
        <h1>檔案</h1>
        <p class="lead">保存過的判決列表、範圍整理表與精讀結果。垃圾桶中的項目可以還原，或永久刪除。</p>
        <div class="tabs" role="tablist">
          <button class="tab active" id="fileTabActive" data-tab="active" type="button">使用中</button>
          <button class="tab" id="fileTabArchived" data-tab="archived" type="button">已封存</button>
          <button class="tab" id="fileTabTrashed" data-tab="trashed" type="button">垃圾桶</button>
        </div>
        <p class="status" id="filesStatus" role="status"></p>
        <ul class="file-list" id="fileList"></ul>
      </section>
`;
})(window.JR);
