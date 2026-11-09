// 本地模組視窗啟動：主題、視窗控制、綁定各控制器，最後依啟動參數與任務狀態決定第一個畫面。
(function (WZ) {
  'use strict';
  var api = window.api;
  if (!api || !api.localAi) return;

  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* 忽略 */ }

  // 視窗控制（與主畫面相同）
  document.querySelectorAll('[data-win]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-win');
      if (k === 'minimize') api.win.minimize();
      else if (k === 'toggleMaximize') api.win.toggleMaximize();
      else if (k === 'close') api.win.close();
    });
  });

  WZ.controllers.check.bind();
  WZ.controllers.choose.bind();
  WZ.controllers.install.bind();
  WZ.controllers.diag.bind();
  WZ.controllers.modules.bind();
  WZ.controllers.nav.bind();

  // ---- 啟動 ----
  var startView = new URLSearchParams(window.location.search).get('view');
  WZ.views.resetStages();
  WZ.views.renderStages();
  if (startView === 'diag') { WZ.state.maxReached = 0; }

  api.localAi.onChanged(function () {
    api.localAi.jobStatus().then(function (job) {
      if (!job.running && WZ.state.installStatus === 'running') WZ.controllers.install.restoreFromJob(job);
      WZ.views.renderSideStates();
      WZ.controllers.modules.refresh();
    });
  });

  api.localAi.jobStatus().then(function (job) {
    if (!WZ.controllers.install.restoreFromJob(job)) WZ.controllers.nav.show(startView === 'diag' ? 'diag' : 'check');
    WZ.views.renderSideStates();
  }).catch(function () { WZ.controllers.nav.show(startView === 'diag' ? 'diag' : 'check'); });
})(window.WZ);
