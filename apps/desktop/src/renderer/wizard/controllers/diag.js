// 控制器：排除問題（執行檢查、修復、匯出報告）。
(function (WZ) {
  'use strict';
  var $ = WZ.$;
  var api = window.api;

  function runDiagnose() {
    WZ.views.setDiagChecking();
    api.localAi.diagnose().then(function (s) {
      WZ.views.renderDiagnosis(s, fixFromDiag);
    }).catch(WZ.views.setDiagError);
  }

  function fixFromDiag(action, btn) {
    btn.disabled = true;
    WZ.views.setDiagMsg('執行修復：' + (WZ.FIX_NAMES[action] || action) + '…');
    api.localAi.repair({ action: action }).then(function () {
      WZ.views.setDiagMsg('修復完成，重新檢查中。', 'ok');
      runDiagnose();
    }).catch(function (e) {
      WZ.views.setDiagMsg('修復沒有成功：' + WZ.errMsg(e), 'error');
      btn.disabled = false;
    });
  }

  WZ.controllers.diag = {
    run: runDiagnose,
    bind: function () {
      $('btnDiagRun').addEventListener('click', runDiagnose);
      $('btnDiagExport').addEventListener('click', function () {
        api.localAi.exportReport().then(function (p) {
          WZ.views.setDiagMsg('已匯出：' + p, 'ok');
        }).catch(function (e) {
          WZ.views.setDiagMsg('匯出失敗：' + WZ.errMsg(e), 'error');
        });
      });
    }
  };
})(window.WZ);
