// 視圖：第 4 步「安裝與註冊」：階段清單、進度條、失敗說明。
(function (WZ) {
  'use strict';
  var $ = WZ.$, h = WZ.h, clear = WZ.clear;

  WZ.views.resetStages = function () {
    WZ.stageState = {};
    WZ.STAGES.forEach(function (s) { WZ.stageState[s[0]] = { status: 'pending', detail: '', completed: 0, total: 0 }; });
  };

  WZ.views.renderStages = function () {
    var stageState = WZ.stageState;
    var list = $('stageList');
    clear(list);
    WZ.STAGES.forEach(function (s) {
      var st = stageState[s[0]];
      var li = h('li', null, 'wiz-stage ' + st.status);
      li.appendChild(h('span', WZ.MARK[st.status] || '○', 'wiz-stage-mark'));
      var body = h('div', null, 'wiz-stage-body');
      body.appendChild(h('div', s[1], 'wiz-stage-title'));
      var sub = st.detail || '';
      if (st.status === 'running' && st.total) sub = (sub ? sub + '　' : '') + Math.floor((st.completed / st.total) * 100) + '%';
      if (sub) body.appendChild(h('div', sub, 'wiz-stage-detail'));
      li.appendChild(body);
      li.appendChild(h('span', WZ.STATUS_TEXT[st.status], 'wiz-stage-status'));
      list.appendChild(li);
    });
    var done = WZ.STAGES.filter(function (s) { return stageState[s[0]].status === 'done'; }).length;
    var running = WZ.STAGES.filter(function (s) { return stageState[s[0]].status === 'running'; })[0];
    var frac = done / WZ.STAGES.length;
    if (running && running.total) frac += (running.completed / running.total) / WZ.STAGES.length;
    var bar = $('installProgress');
    bar.hidden = WZ.state.installStatus === 'idle';
    bar.firstElementChild.style.width = Math.min(100, Math.floor(frac * 100)) + '%';
  };

  /** 把一筆進度事件套用到對應階段。 */
  WZ.views.applyStageEvent = function (p) {
    var st = WZ.stageState[p.stage];
    if (!st) return;
    if (p.status === 'start') st.status = 'running';
    else if (p.status === 'done') st.status = 'done';
    else if (p.status === 'failed') st.status = 'failed';
    else if (p.status === 'retry') st.status = 'retry';
    else if (p.status === 'progress') { st.status = 'running'; st.completed = p.completed || 0; st.total = p.total || 0; }
    if (p.detail) st.detail = p.detail;
    WZ.views.renderStages();
  };

  WZ.views.markAllStagesDone = function () {
    WZ.STAGES.forEach(function (x) { WZ.stageState[x[0]].status = 'done'; });
  };

  WZ.views.setInstallLead = function (text) { $('installLead').textContent = text; };

  /** 失敗說明：原因（技術訊息）與使用者可執行的步驟。lastError 格式：「代碼：技術訊息｜使用者可執行的步驟」 */
  WZ.views.renderFailure = function (lastError, failedStage) {
    var stageName = WZ.STAGES.filter(function (s) { return s[0] === failedStage; })[0];
    $('installLead').textContent = '安裝沒有完成，已停在「' + (stageName ? stageName[1] : '未知步驟') + '」。已完成的步驟會保留，重試時會從中斷處續傳。';
    var parts = String(lastError).split('｜');
    $('failTitle').textContent = '這次失敗的原因';
    $('failTech').textContent = parts[0];
    var steps = $('failSteps');
    clear(steps);
    (parts[1] ? parts[1].split(/(?<=。)/) : []).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) {
      steps.appendChild(h('li', s));
    });
    if (!steps.firstChild) steps.appendChild(h('li', '可按「排除問題」逐項檢查，或按「重試」。'));
    $('failBox').hidden = false;
    $('btnToDone').disabled = true;
    WZ.views.renderStages();
  };
})(window.WZ);
