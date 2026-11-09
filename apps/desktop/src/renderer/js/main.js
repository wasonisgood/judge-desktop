// 啟動：掛載頁面、綁定各控制器，最後讀取設定與應用程式資訊。
(function (JR) {
  'use strict';
  var api = window.api;

  JR.views.mountPages();
  JR.controllers.chrome.bind();
  JR.controllers.settings.bind();
  JR.controllers.list.bind();
  JR.controllers.scope.bind();
  JR.controllers.brief.bind();
  JR.controllers.files.bind();
  JR.controllers.assistant.bind();
  JR.controllers.localAi.bind();

  api.appInfo().then(function (info) {
    JR.$('versionInfo').textContent = '版本 ' + info.version + (info.packaged ? '' : '（開發版）');
  });
  JR.controllers.settings.load();
})(window.JR);
