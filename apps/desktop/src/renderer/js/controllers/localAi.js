// 控制器：設定頁的本地模組摘要與更新程式狀態。只顯示狀態；安裝一律在獨立的精靈視窗進行。
(function (JR) {
  'use strict';
  var $ = JR.$;

  function refresh() {
    window.api.localAi.modules().then(JR.views.renderModuleSummary).catch(function (err) {
      JR.components.notice('讀取本地 AI 狀態失敗：' + JR.errText(err));
    });
  }

  function refreshUpdater() {
    window.api.updaterStatus().then(JR.views.renderUpdaterSummary).catch(function () { /* 讀取失敗時保留上一次的內容 */ });
  }

  JR.controllers.localAi = {
    bind: function () {
      if (!window.api || !window.api.localAi) return;
      $('openWizard').addEventListener('click', function () { window.api.localAi.openWizard(); });
      $('openDiag').addEventListener('click', function () { window.api.localAi.openWizard({ view: 'diag' }); });
      // 更新程式狀態：每 3 秒讀取一次（更新程式執行中或閒置都會即時反映）。
      refreshUpdater();
      setInterval(refreshUpdater, 3000);
      window.api.localAi.onChanged(refresh);
      refresh();
    }
  };
})(window.JR);
