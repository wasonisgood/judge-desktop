// 控制器：文本擷取（五步流程）。每一步為背景工作（kind 'crawl'），作業中所有「執行」按鈕暫停；進度與結果以文字呈現。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var PAGE = 'crawl';
  var STEP_NAME = { 1: '取得清單', 2: '取得文本', 3: '歷審', 4: '歷審文本', 5: '確定判決' };
  var files = {};

  function setBusy(busy) {
    document.querySelectorAll('#page-crawl [data-run], #page-crawl [data-pick]').forEach(function (b) { b.disabled = busy; });
  }

  function showProgress(p) {
    var box = $('crawlProgress');
    if (!box) return;
    if (!p || !p.total) { box.hidden = true; return; }
    box.hidden = false;
    box.querySelector('.bar').style.width = Math.min(100, Math.round((p.done / p.total) * 100)) + '%';
    JR.setStatus($('crawlStatus'), '執行中：Step ' + p.step + ' ' + STEP_NAME[p.step] + '（' + p.done + ' / ' + p.total + '）' + (p.label ? ' ' + p.label : ''));
  }

  function showResult(r) {
    var box = $('crawlResult');
    box.textContent = '';
    var msg = document.createElement('p');
    msg.textContent = 'Step ' + r.step + ' ' + STEP_NAME[r.step] + '：' + r.message;
    box.appendChild(msg);
    (r.outputs || []).forEach(function (p) {
      var li = document.createElement('div');
      li.className = 'crawl-output';
      li.textContent = p;
      box.appendChild(li);
    });
  }

  function run(step) {
    if (JR.jobs.isBusy(PAGE)) return;
    var input = step === 1 ? $('crawlQuery').value.trim() : files[step];
    if (!input) {
      JR.setStatus($('crawlStatus'), step === 1 ? '請輸入關鍵字或司法院查詢結果網址。' : '請先選擇清單檔。', 'err');
      return;
    }
    var args = { runId: JR.jobs.start(PAGE, 'crawlCancel'), step: step, input: input };
    if (step === 5) args.appealDays = Math.max(1, Math.floor(Number($('crawlAppealDays').value) || 120));
    setBusy(true);
    $('crawlResult').textContent = '';
    JR.setStatus($('crawlStatus'), '開始 Step ' + step + ' ' + STEP_NAME[step] + '…');
    api.crawl.run(args).then(function (r) {
      showResult(r);
      JR.setStatus($('crawlStatus'), r.message, r.failed ? '' : 'ok');
      // Step 3 完成後，自動把產生的歷審清單帶入 Step 4 與 Step 5。
      var history = (r.outputs || []).filter(function (p) { return /_歷審\.xlsx$/.test(p); })[0];
      if (step === 3 && history) {
        files[4] = history;
        files[5] = history;
        $('crawlFile4').textContent = history;
        $('crawlFile5').textContent = history;
      }
    }, function (err) {
      JR.setStatus($('crawlStatus'), JR.errText(err), 'err');
    }).then(function () {
      JR.jobs.finish(PAGE);
      setBusy(false);
      showProgress(null);
    });
  }

  function pick(step) {
    api.crawl.pickFile().then(function (p) {
      if (!p) return;
      files[step] = p;
      $('crawlFile' + step).textContent = p;
    }, function (err) {
      JR.setStatus($('crawlStatus'), JR.errText(err), 'err');
    });
  }

  JR.controllers.crawl = {
    bind: function () {
      document.querySelectorAll('#page-crawl [data-run]').forEach(function (b) {
        b.addEventListener('click', function () { run(Number(b.dataset.run)); });
      });
      document.querySelectorAll('#page-crawl [data-pick]').forEach(function (b) {
        b.addEventListener('click', function () { pick(Number(b.dataset.pick)); });
      });
      if (api && api.crawl) api.crawl.onProgress(showProgress);
    }
  };
})(window.JR);
