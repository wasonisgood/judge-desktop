// 控制器：模組（狀態顯示、爬取模組安裝或修復）。模組隨應用程式版本更新，這裡不提供獨立的更新動作。
(function (WZ) {
  'use strict';
  var $ = WZ.$;
  var api = window.api;

  function refresh() {
    api.localAi.modules().then(WZ.views.renderModules);
    api.appInfo().then(function (info) {
      $('modVersionNote').textContent = '目前應用程式版本 ' + info.version + '。模組會在啟動時依版本自動同步，有變動的檔案才會更新。';
    }).catch(function () { /* 版本資訊讀取失敗時保留原文字 */ });
  }

  WZ.controllers.modules = {
    refresh: refresh,
    bind: function () {
      $('crawlerInstall').addEventListener('click', function () {
        var btn = $('crawlerInstall');
        btn.disabled = true;
        api.localAi.installCrawler().then(function () { refresh(); }).catch(function (e) {
          WZ.views.setUpdMsg('爬取模組安裝失敗：' + WZ.errMsg(e), 'error');
        }).finally(function () { btn.disabled = false; });
      });
    }
  };
})(window.WZ);
