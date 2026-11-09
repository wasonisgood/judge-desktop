// 工作管理（v3.6.0）：每一頁同時間只允許一項工作；提供取消、忙碌檢查，以及全域的「背景工作」橫幅。
// 主程序是工作狀態的唯一來源；這裡只記錄本頁發出的工作，並把取消要求交給主程序。
(function (JR) {
  'use strict';
  var api = window.api;
  var runs = {};
  var seq = 0;

  function newRunId() {
    seq += 1;
    return 'ui-' + Date.now() + '-' + seq + '-' + Math.random().toString(36).slice(2, 7);
  }

  function setCancelButton(id, state) {
    var b = id && document.getElementById(id);
    if (!b) return;
    if (state === 'hidden') { b.hidden = true; return; }
    b.hidden = false;
    b.disabled = state === 'cancelling';
    b.textContent = state === 'cancelling' ? '取消中…' : '取消';
  }

  var BANNER_LABEL = { search: '判決搜尋', scope: '標編碼標注工序', brief: '精讀', assistant: '助理對話', install: '模組安裝', repair: '模組修復' };

  function renderBanner(list) {
    var banner = document.getElementById('jobBanner');
    if (!banner) return;
    var running = (list || []).filter(function (j) { return j.status === 'running'; });
    banner.innerHTML = '';
    if (running.length === 0) { banner.hidden = true; return; }
    banner.hidden = false;
    var msg = document.createElement('span');
    msg.textContent = '背景工作進行中（' + running.length + ' 項）：' + running.map(function (j) { return j.label || BANNER_LABEL[j.kind] || j.kind; }).join('、') + '。工作完成後會以系統通知告知。';
    banner.appendChild(msg);
    running.forEach(function (j) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = '取消「' + (BANNER_LABEL[j.kind] || j.kind) + '」';
      b.addEventListener('click', function () { api.jobs.cancel({ id: j.id }); });
      banner.appendChild(b);
    });
  }

  JR.jobs = {
    /** 這一頁是否有工作進行中。 */
    isBusy: function (page) { return !!runs[page]; },
    /** 開始一項工作：回傳識別碼（傳給主程序）；取消按鈕顯示。 */
    start: function (page, cancelBtnId) {
      var id = newRunId();
      runs[page] = { runId: id, cancelBtn: cancelBtnId };
      setCancelButton(cancelBtnId, 'running');
      return id;
    },
    /** 工作結束（不論成功、取消或失敗）：清除狀態與取消按鈕。 */
    finish: function (page) {
      var r = runs[page];
      if (!r) return;
      delete runs[page];
      setCancelButton(r.cancelBtn, 'hidden');
    },
    /** 要求取消這一頁的工作。 */
    cancel: function (page) {
      var r = runs[page];
      if (!r) return Promise.resolve({ ok: false });
      setCancelButton(r.cancelBtn, 'cancelling');
      return api.jobs.cancel({ id: r.runId });
    },
    /** 初始化：綁定取消按鈕、建立背景工作橫幅並監聽變化。 */
    init: function () {
      var map = { listCancel: 'list', scopeCancel: 'scope', briefCancel: 'brief', assistCancel: 'assistant' };
      Object.keys(map).forEach(function (btnId) {
        var b = document.getElementById(btnId);
        if (b) b.addEventListener('click', function () { JR.jobs.cancel(map[btnId]); });
      });
      if (api && api.jobs) {
        api.jobs.onChanged(renderBanner);
        api.jobs.list().then(renderBanner).catch(function () { /* 讀取失敗時不顯示橫幅 */ });
      }
    },
    newRunId: newRunId
  };
})(window.JR);
