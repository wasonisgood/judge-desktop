// 控制器：第 2 步（選擇方案）與第 3 步（同意）的事件。
(function (WZ) {
  'use strict';
  var $ = WZ.$;

  WZ.controllers.choose = {
    /** 渲染方案並綁定選擇事件（選擇後才能按下一步）。 */
    renderOptions: function (options, networkReady) {
      WZ.views.renderOptions(options, networkReady);
      $('optList').querySelectorAll('input[name="aiChoice"]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          WZ.state.choice = inp.value;
          $('btnToAgree').disabled = false;
          WZ.views.renderSideStates();
        });
      });
    },
    bind: function () {
      $('btnCheckNext').addEventListener('click', function () { WZ.controllers.nav.show('choose'); });

      $('btnToAgree').addEventListener('click', function () {
        var state = WZ.state;
        var sel = document.querySelector('input[name="aiChoice"]:checked');
        if (!sel) return;
        state.choice = sel.value;
        WZ.flow.reach('agree');
        var opt = state.plan.options.find(function (o) { return o.id === state.choice; });
        WZ.views.renderAgree(opt);
        $('agreeBox').checked = false;
        state.agreed = false;
        $('btnInstall').disabled = true;
        WZ.controllers.nav.show('agree');
      });

      $('agreeBox').addEventListener('change', function () {
        WZ.state.agreed = $('agreeBox').checked;
        $('btnInstall').disabled = !WZ.state.agreed;
        WZ.views.renderSideStates();
      });
    }
  };
})(window.WZ);
