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
  JR.controllers.auth.bind();
  JR.jobs.init();

  api.appInfo().then(function (info) {
    JR.$('versionInfo').textContent = '版本 ' + info.version + (info.packaged ? '' : '（開發版）');
  });
  JR.controllers.settings.load();
  // 未登入時顯示登入閘門，覆蓋主畫面。
  JR.controllers.auth.checkOnStart();
})(window.JR);
