// 模型：安裝流程規則。只能往前到達過的步驟；安裝開始後不能回到前面的步驟；安裝中不能離開安裝頁（維護頁除外）。
(function (WZ) {
  'use strict';
  var state = WZ.state;

  WZ.flow.reach = function (view) {
    var i = WZ.ORDER_STEPS.indexOf(view);
    if (i > state.maxReached) state.maxReached = i;
  };

  WZ.flow.canEnter = function (view) {
    if (view === 'diag' || view === 'modules') return state.installStatus !== 'running' || view === 'diag';
    var i = WZ.ORDER_STEPS.indexOf(view);
    if (i < 0) return false;
    if (i > state.maxReached) return false;
    if (state.installStarted && i < 3) return false;
    if (state.installStatus === 'running' && view !== 'install') return false;
    return true;
  };
})(window.WZ);
