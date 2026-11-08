// 本地模組安裝精靈（獨立視窗）：檢查 → 選擇方案 → 同意 → 安裝與註冊。
// 只有「註冊成功」才會顯示完成按鈕；失敗時停在安裝步驟並提供修復按鈕。
// 動態內容一律用 textContent / createElement 建立，不使用 innerHTML。
(function () {
  if (!window.api || !api.localAi) return;
  var $ = function (id) { return document.getElementById(id); };
  var STAGE_NAMES = {
    checkSystem: '檢查電腦', checkNetwork: '檢查網路與司法院連線', installEngine: '安裝本地服務',
    verifyEngine: '確認服務運作', pullModels: '下載模型', smokeTest: '測試模型回應', register: '註冊本地 AI',
    smokeFetch: '抓取一筆公開資料測試'
  };
  var REPAIR_NAMES = { retry: '重試（從中斷處續傳）', 'restart-service': '重新啟動本地服務', 'redownload-installer': '重新下載安裝檔', reregister: '重新註冊' };
  var ORDER = ['check', 'choose', 'agree', 'install'];
  var plan = null;       // 主程序回傳的選項
  var chosenId = null;
  var log = {};          // 階段 → 文字
  var crawlLog = {};

  function show(step) {
    ORDER.forEach(function (s) { $('s-' + s).hidden = s !== step; });
    document.querySelectorAll('#wizTabs .tab').forEach(function (t) {
      var idx = ORDER.indexOf(t.getAttribute('data-s'));
      t.classList.toggle('active', t.getAttribute('data-s') === step);
      t.classList.toggle('done', idx < ORDER.indexOf(step));
    });
  }

  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-go')); });
  });

  // ---- 步驟 1：檢查 ----
  $('btnCheck').addEventListener('click', function () {
    var btn = $('btnCheck');
    btn.disabled = true;
    $('checkStatus').textContent = '檢查中，請稍候…';
    $('checkStatus').className = 'status';
    api.localAi.plan().then(function (r) {
      plan = r;
      var hw = r.hardware;
      var net = r.network.messages.join('；');
      $('checkStatus').textContent = '電腦：記憶體 ' + hw.ramGB + ' GB、可用磁碟 ' + hw.freeDiskGB + ' GB、顯卡 ' + hw.gpuVendor +
        '（顯示記憶體 ' + hw.vramGB + ' GB）。網路：' + net;
      $('checkStatus').className = r.network.ready ? 'status ok' : 'status error';
      renderOptions(r.options, r.network.ready);
      show('choose');
    }).catch(function (e) {
      $('checkStatus').textContent = '檢查失敗：' + (e && e.message ? e.message : e);
      $('checkStatus').className = 'status error';
    }).finally(function () { btn.disabled = false; });
  });

  // ---- 步驟 2：選擇方案 ----
  function renderOptions(options, networkReady) {
    var box = $('optList');
    box.textContent = '';
    chosenId = null;
    options.forEach(function (o, i) {
      var label = document.createElement('label');
      label.className = 'check';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'aiChoice';
      input.value = o.id;
      input.checked = i === 0;
      input.addEventListener('change', function () { chosenId = o.id; });
      label.appendChild(input);
      var p = o.plan;
      var desc = o.id === 'skip' ? '所有 AI 功能使用雲端' :
        '精讀模型 ' + p.judgmentModel + '；回答模型 ' + (p.chatModel === p.judgmentModel ? '同上' : p.chatModel) + '；約需 ' + p.requiredDiskGB + ' GB 磁碟';
      label.appendChild(document.createTextNode(o.label + '：' + desc));
      box.appendChild(label);
    });
    chosenId = options.length ? options[0].id : null;
    // 網路未就緒時不允許安裝（不可用的方案不得往下走）。
    $('btnToAgree').disabled = !networkReady && options.some(function (o) { return o.id !== 'skip'; });
    $('chooseStatus').textContent = networkReady ? '' : '網路檢查未通過，無法安裝本地 AI；可選「不安裝」繼續使用雲端。';
    $('chooseStatus').className = networkReady ? 'status' : 'status error';
  }

  $('btnToAgree').addEventListener('click', function () {
    var sel = document.querySelector('input[name="aiChoice"]:checked');
    if (!sel) return;
    chosenId = sel.value;
    var opt = plan.options.find(function (o) { return o.id === chosenId; });
    if (opt && opt.id === 'skip') {
      $('agreeSummary').textContent = '你選擇「不安裝」。本地 AI 將不會安裝，所有 AI 功能使用雲端。';
      $('btnInstall').textContent = '確定，不安裝';
    } else {
      $('agreeSummary').textContent = '將安裝「' + opt.label + '」：精讀模型 ' + opt.plan.judgmentModel + '，約需 ' + opt.plan.requiredDiskGB +
        ' GB 磁碟。安裝會下載本地服務與模型，過程中可能需要數十分鐘。';
      $('btnInstall').textContent = '開始安裝';
    }
    $('agreeBox').checked = false;
    $('btnInstall').disabled = true;
    show('agree');
  });

  // ---- 步驟 3：同意 ----
  $('agreeBox').addEventListener('change', function () { $('btnInstall').disabled = !$('agreeBox').checked; });

  // ---- 步驟 4：安裝與註冊 ----
  function logLine(store, p) {
    var name = STAGE_NAMES[p.stage] || p.stage;
    var mark = { start: '開始', done: '完成', failed: '失敗', retry: '重試中', progress: '進行中' }[p.status] || p.status;
    var pct = p.status === 'progress' && p.total ? ' ' + Math.floor((p.completed / p.total) * 100) + '%' : '';
    store[p.stage] = name + '：' + mark + (p.detail ? '（' + p.detail + '）' : '') + pct;
    return Object.keys(store).map(function (k) { return store[k]; }).join('\n');
  }

  api.localAi.onProgress(function (p) {
    if (p.module === 'crawler') {
      $('crawlerLog').textContent = logLine(crawlLog, p);
      return;
    }
    $('installLog').textContent = logLine(log, p);
    if (p.status === 'progress' && p.total) {
      $('progressBar').hidden = false;
      $('progressBar').firstElementChild.style.width = Math.min(100, Math.floor((p.completed / p.total) * 100)) + '%';
    }
  });

  function showRepair(lastError) {
    $('repairBox').hidden = false;
    $('repairText').textContent = '安裝沒有完成：' + (lastError || '未知原因');
    var actions = $('repairActions');
    actions.textContent = '';
    ['retry', 'restart-service', 'redownload-installer', 'reregister'].forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = i === 0 ? 'btn primary' : 'btn';
      b.textContent = REPAIR_NAMES[a];
      b.addEventListener('click', function () { runRepair(a); });
      actions.appendChild(b);
    });
  }

  function finishSuccess(state) {
    $('repairBox').hidden = true;
    $('doneBox').hidden = false;
    $('doneText').textContent = '已完成註冊：AI 引擎模組版本 ' + state.installedVersion + '，精讀與範圍整理會優先使用本地模型。';
  }

  function runInstall(fn) {
    log = {};
    $('installLog').textContent = '';
    $('doneBox').hidden = true;
    $('repairBox').hidden = true;
    $('progressBar').hidden = true;
    show('install');
    return fn().then(function (state) {
      if (state && state.status === 'ready') finishSuccess(state);
      else if (state && state.status === 'disabled') {
        $('doneText').textContent = '已記錄為「不安裝」，所有 AI 功能使用雲端。';
        $('doneBox').hidden = false;
      } else showRepair(state && state.lastError);
    }).catch(function (e) {
      showRepair(e && e.message ? e.message : String(e));
    });
  }

  $('btnInstall').addEventListener('click', function () {
    var btn = $('btnInstall');
    btn.disabled = true;
    runInstall(function () { return api.localAi.installAi({ choice: chosenId }); })
      .finally(function () { btn.disabled = false; });
  });

  function runRepair(action) {
    runInstall(function () { return api.localAi.repair({ action: action }); });
  }

  $('btnDone').addEventListener('click', function () { api.localAi.wizardDone(); });

  // ---- 爬取模組 ----
  $('crawlerInstall').addEventListener('click', function () {
    var btn = $('crawlerInstall');
    btn.disabled = true;
    crawlLog = {};
    $('crawlerLog').textContent = '';
    api.localAi.installCrawler().then(function (state) {
      $('crawlerStatus').textContent = state.status === 'ready' ? '爬取模組：已安裝並啟用' : '爬取模組安裝失敗：' + (state.lastError || '');
      $('crawlerStatus').className = state.status === 'ready' ? 'status ok' : 'status error';
    }).catch(function (e) {
      $('crawlerStatus').textContent = '安裝失敗：' + (e && e.message ? e.message : e);
      $('crawlerStatus').className = 'status error';
    }).finally(function () { btn.disabled = false; });
  });

  api.localAi.modules().then(function (reg) {
    var cr = reg.crawler;
    $('crawlerStatus').textContent = '爬取模組：' + (cr.status === 'ready' ? '已安裝並啟用' : cr.status === 'failed' ? '安裝失敗' : '尚未安裝');
  });

  show('check');
})();
