// 視圖：左側流程導覽的啟用狀態與各步驟的狀態文字。
(function (WZ) {
  'use strict';

  /** 高亮目前視圖，並顯示該視圖。 */
  WZ.views.showView = function (view) {
    document.querySelectorAll('.wiz-view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== view; });
    document.querySelectorAll('.wiz-nav').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  };

  WZ.views.renderSideStates = function () {
    var state = WZ.state;
    document.querySelectorAll('.wiz-nav').forEach(function (b) {
      b.disabled = !WZ.flow.canEnter(b.getAttribute('data-view'));
    });
    var st = {
      check: state.plan ? '已完成' : '',
      choose: state.choice ? '已選擇' : '',
      agree: state.agreed ? '已同意' : '',
      install: state.installStatus === 'running' ? '進行中' : state.installStatus === 'failed' ? '未完成' : state.installStatus === 'ready' ? '已完成' : '',
      done: state.installStatus === 'ready' ? '已註冊' : ''
    };
    document.querySelectorAll('[data-state-for]').forEach(function (s) {
      s.textContent = st[s.getAttribute('data-state-for')] || '';
    });
  };
})(window.WZ);
