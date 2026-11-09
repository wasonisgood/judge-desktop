// 控制器：第 1 步「檢查電腦」與第 2 步的方案渲染（方案選項的事件綁定在 choose.js）。
(function (WZ) {
  'use strict';
  var $ = WZ.$;
  var api = window.api;

  WZ.controllers.check = {
    bind: function () {
      $('btnCheck').addEventListener('click', function () {
        var btn = $('btnCheck');
        btn.disabled = true;
        WZ.views.setCheckBusy();
        api.localAi.plan().then(function (r) {
          WZ.state.plan = r;
          WZ.flow.reach('choose');
          $('btnCheckNext').disabled = false;
          WZ.views.renderCheckResult(r);
          WZ.controllers.choose.renderOptions(r.options, r.network.ready);
          $('btnToAgree').disabled = !WZ.state.choice;
          WZ.views.renderSideStates();
        }).catch(function (e) {
          WZ.views.setCheckError(e);
        }).finally(function () { btn.disabled = false; });
      });
    }
  };
})(window.WZ);
