// 視圖：檔案列表（依分頁顯示項目，或顯示空白／錯誤狀態）。
(function (JR) {
  'use strict';

  JR.views.renderFiles = function (items, tab, handlers) {
    var list = JR.$('fileList');
    list.innerHTML = '';
    JR.setStatus(JR.$('filesStatus'), items.length ? '' : '這裡沒有項目。');
    items.forEach(function (it) { list.appendChild(JR.components.fileItem(it, tab, handlers)); });
  };

  JR.views.clearFiles = function () { JR.$('fileList').innerHTML = ''; };

  JR.views.setFilesError = function (err) {
    JR.setStatus(JR.$('filesStatus'), '讀取失敗：' + JR.errText(err), 'error');
  };
})(window.JR);
