// 控制器：模組與更新（爬取模組安裝、檢查更新、套用更新）。
(function (WZ) {
  'use strict';
  var $ = WZ.$;
  var api = window.api;
  var state = WZ.state;

  function refresh() {
    api.localAi.modules().then(WZ.views.renderModules);
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

      $('btnUpdCheck').addEventListener('click', function () {
        $('updSummary').textContent = '檢查中…';
        $('updSummary').className = 'wiz-summary';
        api.localAi.checkUpdates().then(function (r) {
          var anyChange = WZ.views.renderUpdatePlans(r);
          if (!r.ok) {
            state.pendingApply = false;
            $('btnUpdApply').disabled = true;
            return;
          }
          state.pendingApply = anyChange;
          $('btnUpdApply').disabled = !anyChange;
        }).catch(function (e) {
          $('updSummary').textContent = '檢查失敗：' + WZ.errMsg(e);
          $('updSummary').className = 'wiz-summary error';
        });
      });

      $('btnUpdApply').addEventListener('click', function () {
        var btn = $('btnUpdApply');
        btn.disabled = true;
        WZ.views.setUpdMsg('套用中…');
        api.localAi.applyUpdates().then(function (r) {
          WZ.views.renderApplyResults(r);
          $('updMsg').textContent = '';
          refresh();
        }).catch(function (e) {
          WZ.views.setUpdMsg('更新失敗：' + WZ.errMsg(e), 'error');
        }).finally(function () { btn.disabled = !state.pendingApply; });
      });
    }
  };
})(window.WZ);
