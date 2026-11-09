// 控制器：流程導覽。進入某步驟前先檢查流程規則（WZ.flow.canEnter），再切換視圖並觸發該頁的資料載入。
(function (WZ) {
  'use strict';

  WZ.controllers.nav = {
    show: function (view) {
      if (!WZ.flow.canEnter(view)) return;
      WZ.views.showView(view);
      if (view === 'diag') WZ.controllers.diag.run();
      if (view === 'modules') WZ.controllers.modules.refresh();
      WZ.views.renderSideStates();
    },
    bind: function () {
      document.querySelectorAll('.wiz-nav').forEach(function (b) {
        b.addEventListener('click', function () { WZ.controllers.nav.show(b.getAttribute('data-view')); });
      });
      document.querySelectorAll('[data-go]').forEach(function (b) {
        b.addEventListener('click', function () { WZ.controllers.nav.show(b.getAttribute('data-go')); });
      });
    }
  };
})(window.WZ);
