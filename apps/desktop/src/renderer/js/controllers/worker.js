// 控制器：背景工人（v3.9.0）。顯示「上次中斷、可續跑」的提示、接收通知點擊後的頁面切換、背景通知設定與測試。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var PAGES = ['home', 'list', 'scope', 'brief', 'files', 'settings'];
  var box = null;

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'workerResume';
    box.className = 'job-banner worker-resume';
    box.setAttribute('role', 'status');
    box.hidden = true;
    $('jobBanner').insertAdjacentElement('afterend', box);
    return box;
  }

  /** 中斷的工作：每一項一列，提供續跑與捨棄。 */
  function renderResumable(list) {
    var el = ensureBox();
    var interrupted = (list || []).filter(function (x) { return x.status === 'interrupted'; });
    el.innerHTML = '';
    if (interrupted.length === 0) { el.hidden = true; return; }
    el.hidden = false;
    interrupted.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'worker-resume-row';
      var msg = document.createElement('span');
      var progress = item.progress ? '（上次進行到：' + item.progress + '）' : '';
      msg.textContent = '「' + item.label + '」因程式結束而中斷' + progress + '。續跑會依原來的設定重新執行。';
      row.appendChild(msg);

      var resume = document.createElement('button');
      resume.type = 'button';
      resume.className = 'btn small primary';
      resume.textContent = '續跑';
      resume.addEventListener('click', function () {
        api.worker.resume({ id: item.id }).catch(function (err) { JR.components.notice('續跑失敗：' + JR.errText(err)); });
      });
      row.appendChild(resume);

      var discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'btn small';
      discard.textContent = '捨棄';
      discard.addEventListener('click', function () {
        api.worker.discard({ id: item.id }).catch(function (err) { JR.components.notice('捨棄失敗：' + JR.errText(err)); });
      });
      row.appendChild(discard);
      el.appendChild(row);
    });
  }

  function loadSettings() {
    return api.worker.settingsGet().then(function (s) {
      $('setWorkerNotify').checked = !!s.enabled;
      $('setWorkerStyle').value = s.style === 'system' ? 'system' : 'custom';
    }).catch(function () { /* 讀取失敗時維持預設顯示 */ });
  }

  JR.controllers.worker = {
    bind: function () {
      if (!api || !api.worker) return;
      api.worker.onChanged(renderResumable);
      api.worker.onOpen(function (p) {
        var page = p && PAGES.indexOf(p.page) >= 0 ? p.page : 'home';
        JR.nav.showPage(page);
      });
      api.worker.list().then(renderResumable).catch(function () { /* 讀取失敗時不顯示提示 */ });

      $('setWorkerNotify').addEventListener('change', function () {
        var on = $('setWorkerNotify').checked;
        api.worker.settingsSet({ enabled: on }).then(function () {
          JR.components.notice(on ? '已開啟背景工作通知。' : '已關閉背景工作通知。');
        }).catch(function (err) {
          $('setWorkerNotify').checked = !on;
          JR.components.notice('設定沒有保存：' + JR.errText(err));
        });
      });
      $('setWorkerStyle').addEventListener('change', function () {
        var style = $('setWorkerStyle').value;
        api.worker.settingsSet({ style: style }).then(function () {
          JR.components.notice(style === 'system' ? '通知樣式已改為系統通知（Linux 仍使用自訂樣式）。' : '通知樣式已改為自訂樣式。');
        }).catch(function (err) {
          JR.components.notice('設定沒有保存：' + JR.errText(err));
        });
      });
      $('workerTest').addEventListener('click', function () {
        api.worker.test().then(function (r) {
          if (r.channel === 'none') JR.components.notice('背景工作通知目前是關閉的，請先開啟。');
          else JR.components.notice('已送出測試通知（' + (r.channel === 'custom' ? '自訂樣式' : '系統通知') + '）。');
        }).catch(function (err) {
          JR.components.notice('測試通知失敗：' + JR.errText(err));
        });
      });
      loadSettings();
    }
  };
})(window.JR);
