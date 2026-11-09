// 控制器：第 4 步（安裝與註冊）、第 5 步（完成）、安裝進度事件，以及重新開啟精靈時依任務狀態還原畫面。
(function (WZ) {
  'use strict';
  var $ = WZ.$;
  var api = window.api;
  var state = WZ.state;

  // v3.6.0：每次安裝/修復都有識別碼，可取消；主程序是工作狀態的唯一來源。
  function newRunId() {
    return 'wz-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  function runInstall(fn) {
    if (state.installStatus === 'running') return Promise.resolve();
    state.runId = newRunId();
    $('btnCancelInstall').hidden = false;
    $('btnCancelInstall').disabled = false;
    $('btnCancelInstall').textContent = '取消安裝';
    WZ.views.resetStages();
    state.installStatus = 'running';
    state.installStarted = true;
    WZ.flow.reach('install');
    state.lastError = null;
    state.failedStage = null;
    $('failBox').hidden = true;
    $('btnToDone').disabled = true;
    $('installLead').textContent = '安裝進行中，請保持網路連線。關閉此視窗不會中斷，但會留下未完成的狀態。';
    WZ.controllers.nav.show('install');
    WZ.views.renderStages();
    return fn().then(function (s) {
      if (s && s.status === 'ready') {
        state.installStatus = 'ready';
        WZ.flow.reach('done');
        state.installedVersion = s.installedVersion;
        $('installLead').textContent = '安裝完成，已註冊並啟用。';
        $('btnToDone').disabled = false;
        WZ.views.renderStages();
        WZ.views.renderDone(true);
      } else if (s && s.status === 'disabled') {
        state.installStatus = 'ready';
        $('installLead').textContent = '已記錄為「不安裝」。';
        $('btnToDone').disabled = false;
        WZ.views.renderDone(false);
      } else {
        failInstall(s && s.lastError, s && s.failedStage);
      }
    }).catch(function (e) {
      failInstall(WZ.errMsg(e), null);
    }).finally(function () {
      $('btnCancelInstall').hidden = true;
      WZ.views.renderSideStates();
    });
  }

  function failInstall(lastError, failedStage) {
    state.installStatus = 'failed';
    state.lastError = lastError || '未知原因';
    state.failedStage = failedStage || null;
    WZ.views.renderFailure(state.lastError, state.failedStage);
  }

  /** 重新開啟精靈時，依主程序的任務狀態還原畫面（安裝中、已完成或失敗）。 */
  function restoreFromJob(job) {
    if (!job) return false;
    if (job.running && job.kind === 'install') {
      // 重新開啟精靈：找回執行中安裝的識別碼，讓「取消安裝」可用（v3.6.0）。
      api.jobs.list().then(function (list) {
        var running = (list || []).filter(function (j) { return j.status === 'running' && j.kind === 'install'; })[0];
        if (running) { state.runId = running.id; $('btnCancelInstall').hidden = false; $('btnCancelInstall').disabled = false; }
      });
      state.installStatus = 'running';
      state.installStarted = true;
      WZ.flow.reach('install');
      WZ.views.resetStages();
      (job.events || []).forEach(WZ.views.applyStageEvent);
      WZ.views.setInstallLead('安裝進行中，請保持網路連線。關閉此視窗不會中斷安裝。');
      $('btnToDone').disabled = true;
      $('failBox').hidden = true;
      WZ.controllers.nav.show('install');
      return true;
    }
    if (!job.running && job.result) {
      var r = job.result;
      state.installStarted = true;
      WZ.flow.reach('install');
      WZ.views.resetStages();
      if (r.status === 'ready') {
        state.installStatus = 'ready';
        WZ.flow.reach('done');
        WZ.views.setInstallLead('安裝完成，已註冊並啟用。');
        WZ.views.markAllStagesDone();
        WZ.views.renderStages();
        $('btnToDone').disabled = false;
        WZ.views.renderDone(true);
        WZ.controllers.nav.show('done');
        return true;
      }
      if (r.status === 'failed') {
        state.installStatus = 'failed';
        failInstall(r.lastError, r.failedStage);
        WZ.controllers.nav.show('install');
        return true;
      }
    }
    return false;
  }

  WZ.controllers.install = {
    restoreFromJob: restoreFromJob,
    bind: function () {
      api.localAi.onProgress(function (p) {
        if (p.module === 'crawler') return;
        if (p.stage === 'update') { $('updMsg').textContent = p.detail || ''; return; }
        if (WZ.stageState[p.stage]) WZ.views.applyStageEvent(p);
      });

      $('btnInstall').addEventListener('click', function () {
        if (!state.choice) return;
        var btn = $('btnInstall');
        btn.disabled = true;
        runInstall(function () { return api.localAi.installAi({ runId: state.runId, choice: state.choice }); })
          .finally(function () { btn.disabled = !state.agreed; });
      });

      $('btnRetry').addEventListener('click', function () {
        runInstall(function () { return api.localAi.repair({ runId: state.runId, action: 'retry' }); });
      });
      $('btnFailDiag').addEventListener('click', function () { WZ.controllers.nav.show('diag'); });

      $('btnFinish').addEventListener('click', function () { api.localAi.wizardDone(); });
      $('btnCancelInstall').addEventListener('click', function () {
        if (!state.runId) return;
        $('btnCancelInstall').disabled = true;
        $('btnCancelInstall').textContent = '取消中…';
        api.jobs.cancel({ id: state.runId });
      });
    }
  };
})(window.WZ);
