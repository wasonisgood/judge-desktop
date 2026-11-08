// 本地模組視窗（3.1 重新設計）：與主畫面相同的標題列與色彩；左側為流程（安裝五步）與維護（排除問題、模組與更新）。
// 所有動態文字都用 textContent 建立，不使用 innerHTML。
(function () {
  if (!window.api || !api.localAi) return;

  // ---- 共用工具 ----
  function $(id) { return document.getElementById(id); }
  function h(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  // 顯卡說明：Ollama 只會用 NVIDIA／AMD 獨立顯卡加速；其他顯卡（含 Adreno 等集成顯卡）以 CPU 執行模型。
  function gpuText(hw) {
    if (hw.gpuVendor === 'none') return '未偵測到顯卡資訊';
    var name = hw.gpuName || '（名稱未知）';
    if (hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd') return name + '；獨立顯存 ' + hw.vramGB + ' GB，可用於加速';
    return name + (hw.gpuMemoryShared ? '（共用系統記憶體）' : '') + '；本程式的 Ollama 不會用此顯卡加速，模型以 CPU 執行';
  }

  function setPill(el, label, tone) {
    el.textContent = label;
    el.className = 'wiz-pill ' + (tone || '');
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function fact(dl, label, value) {
    dl.appendChild(h('dt', label));
    dl.appendChild(h('dd', value === null || value === undefined || value === '' ? '—' : String(value)));
  }

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

  // ---- 視圖切換 ----
  var STEP_VIEWS = ['check', 'choose', 'agree', 'install', 'done'];
  var state = { plan: null, choice: null, installStatus: 'idle', lastError: null, failedStage: null, agreed: false, installedVersion: null };

  function show(view) {
    document.querySelectorAll('.wiz-view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== view; });
    document.querySelectorAll('.wiz-nav').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (view === 'diag') runDiagnose();
    if (view === 'modules') refreshModules();
    renderSideStates();
  }
  document.querySelectorAll('.wiz-nav').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-view')); });
  });
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-go')); });
  });

  function renderSideStates() {
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
  }

  // ---- 1 檢查 ----
  $('btnCheck').addEventListener('click', function () {
    var btn = $('btnCheck');
    btn.disabled = true;
    $('checkMsg').textContent = '檢查中，請稍候…';
    $('checkMsg').className = 'status';
    api.localAi.plan().then(function (r) {
      state.plan = r;
      var hw = r.hardware;
      var f = $('checkFacts');
      clear(f);
      fact(f, '處理器架構', r.nativeArch === 'arm64' ? 'ARM64' : r.nativeArch === 'x64' ? 'x64' : r.nativeArch);
      fact(f, '記憶體', hw.ramGB + ' GB');
      fact(f, '可用磁碟', hw.freeDiskGB + ' GB');
      fact(f, '顯卡', gpuText(hw));
      fact(f, '分級規則', r.rulesSource === 'module' ? '模組更新版' : '內建版');
      var net = $('checkNet');
      clear(net);
      r.network.results.forEach(function (x) {
        var li = h('li', null, 'wiz-row');
        var body = h('div', null, 'wiz-row-body');
        body.appendChild(h('div', x.name, 'wiz-row-title'));
        body.appendChild(h('div', x.ok ? '可以連線（' + x.latencyMs + ' ms）' : (x.error || '無法連線'), 'wiz-row-detail'));
        li.appendChild(body);
        var pill = h('span', x.ok ? '通過' : '失敗', 'wiz-pill ' + (x.ok ? 'pass' : 'fail'));
        li.appendChild(pill);
        net.appendChild(li);
      });
      $('checkMsg').textContent = r.network.ready ? '檢查完成。請到下一步選擇方案。' : '網路檢查未通過：司法院網站無法連線。若使用 VPN，請切換節點後重試；也可以選擇「不安裝」只用雲端。';
      $('checkMsg').className = r.network.ready ? 'status ok' : 'status error';
      renderOptions(r.options, r.network.ready);
      $('btnToAgree').disabled = !state.choice;
      renderSideStates();
    }).catch(function (e) {
      $('checkMsg').textContent = '檢查失敗：' + (e && e.message ? e.message : e);
      $('checkMsg').className = 'status error';
    }).finally(function () { btn.disabled = false; });
  });

  // ---- 2 選擇方案 ----
  function renderOptions(options, networkReady) {
    var box = $('optList');
    clear(box);
    state.choice = null;
    options.forEach(function (o, i) {
      var card = h('label', null, 'wiz-option');
      var input = h('input');
      input.type = 'radio';
      input.name = 'aiChoice';
      input.value = o.id;
      input.checked = i === 0;
      card.appendChild(input);
      var body = h('div', null, 'wiz-option-body');
      var head = h('div', null, 'wiz-option-head');
      head.appendChild(h('span', o.label, 'wiz-option-title'));
      if (o.id === 'recommended') head.appendChild(h('span', '建議', 'wiz-pill pass'));
      body.appendChild(head);
      var p = o.plan;
      var desc = o.id === 'skip'
        ? '不安裝本地 AI，所有 AI 功能使用雲端。'
        : '精讀模型 ' + p.judgmentModel + '；回答模型 ' + (p.chatModel === p.judgmentModel ? '同上' : p.chatModel) + '。約需 ' + p.requiredDiskGB + ' GB 磁碟。';
      body.appendChild(h('div', desc, 'wiz-option-desc'));
      if (o.id !== 'skip') (p.reasons || []).forEach(function (r) { body.appendChild(h('div', '・' + r, 'wiz-option-reason')); });
      card.appendChild(body);
      box.appendChild(card);
      if (i === 0) state.choice = o.id;
    });
    box.querySelectorAll('input[name="aiChoice"]').forEach(function (inp) {
      inp.addEventListener('change', function () { state.choice = inp.value; $('btnToAgree').disabled = false; renderSideStates(); });
    });
    $('btnToAgree').disabled = !networkReady && options.some(function (o) { return o.id !== 'skip'; });
    $('chooseMsg').textContent = networkReady ? '' : '網路未就緒時只能選擇「不安裝」。';
    $('chooseMsg').className = networkReady ? 'status' : 'status error';
  }

  $('btnToAgree').addEventListener('click', function () {
    var sel = document.querySelector('input[name="aiChoice"]:checked');
    if (!sel) return;
    state.choice = sel.value;
    var opt = state.plan.options.find(function (o) { return o.id === state.choice; });
    var f = $('agreeFacts');
    clear(f);
    fact(f, '方案', opt.label);
    if (opt.id === 'skip') {
      fact(f, '結果', '不安裝，所有 AI 功能使用雲端');
      $('btnInstall').textContent = '確定，不安裝';
    } else {
      fact(f, '精讀模型', opt.plan.judgmentModel);
      fact(f, '回答模型', opt.plan.chatModel);
      fact(f, '所需磁碟', '約 ' + opt.plan.requiredDiskGB + ' GB');
      fact(f, '引擎', '官方 Ollama（zip），以 GitHub 提供的 SHA-256 校驗');
      fact(f, '既有服務', '版本夠新就沿用；太舊不動它，改裝本程式自己的引擎');
      $('btnInstall').textContent = '開始安裝';
    }
    $('agreeBox').checked = false;
    state.agreed = false;
    $('btnInstall').disabled = true;
    show('agree');
  });

  // ---- 3 同意 ----
  $('agreeBox').addEventListener('change', function () {
    state.agreed = $('agreeBox').checked;
    $('btnInstall').disabled = !state.agreed;
    renderSideStates();
  });

  // ---- 4 安裝與註冊 ----
  var STAGES = [
    ['checkSystem', '檢查電腦'], ['checkNetwork', '檢查網路與司法院連線'], ['decideEngine', '判斷既有服務'],
    ['installEngine', '下載並校驗引擎'], ['startService', '啟動本地服務'], ['verifyEngine', '確認服務版本'],
    ['pullModels', '下載模型'], ['smokeTest', '測試模型回應'], ['register', '註冊本地 AI']
  ];
  var stageState = {};

  function resetStages() {
    stageState = {};
    STAGES.forEach(function (s) { stageState[s[0]] = { status: 'pending', detail: '', completed: 0, total: 0 }; });
  }

  var MARK = { pending: '○', running: '●', done: '✓', failed: '✕', retry: '↻' };
  var STATUS_TEXT = { pending: '等待', running: '進行中', done: '完成', failed: '失敗', retry: '重試中' };

  function renderStages() {
    var list = $('stageList');
    clear(list);
    STAGES.forEach(function (s) {
      var st = stageState[s[0]];
      var li = h('li', null, 'wiz-stage ' + st.status);
      li.appendChild(h('span', MARK[st.status] || '○', 'wiz-stage-mark'));
      var body = h('div', null, 'wiz-stage-body');
      body.appendChild(h('div', s[1], 'wiz-stage-title'));
      var sub = st.detail || '';
      if (st.status === 'running' && st.total) sub = (sub ? sub + '　' : '') + Math.floor((st.completed / st.total) * 100) + '%';
      if (sub) body.appendChild(h('div', sub, 'wiz-stage-detail'));
      li.appendChild(body);
      li.appendChild(h('span', STATUS_TEXT[st.status], 'wiz-stage-status'));
      list.appendChild(li);
    });
    var done = STAGES.filter(function (s) { return stageState[s[0]].status === 'done'; }).length;
    var running = STAGES.filter(function (s) { return stageState[s[0]].status === 'running'; })[0];
    var frac = done / STAGES.length;
    if (running && running.total) frac += (running.completed / running.total) / STAGES.length;
    var bar = $('installProgress');
    bar.hidden = state.installStatus === 'idle';
    bar.firstElementChild.style.width = Math.min(100, Math.floor(frac * 100)) + '%';
  }

  function onStageEvent(p) {
    var st = stageState[p.stage];
    if (!st) return;
    if (p.status === 'start') st.status = 'running';
    else if (p.status === 'done') st.status = 'done';
    else if (p.status === 'failed') st.status = 'failed';
    else if (p.status === 'retry') st.status = 'retry';
    else if (p.status === 'progress') { st.status = 'running'; st.completed = p.completed || 0; st.total = p.total || 0; }
    if (p.detail) st.detail = p.detail;
    renderStages();
  }

  api.localAi.onProgress(function (p) {
    if (p.module === 'crawler') return;
    if (p.stage === 'update') { $('updMsg').textContent = p.detail || ''; return; }
    if (stageState[p.stage]) onStageEvent(p);
  });

  function runInstall(fn) {
    resetStages();
    state.installStatus = 'running';
    state.lastError = null;
    state.failedStage = null;
    $('failBox').hidden = true;
    $('btnToDone').disabled = true;
    $('installLead').textContent = '安裝進行中，請保持網路連線。關閉此視窗不會中斷，但會留下未完成的狀態。';
    show('install');
    renderStages();
    return fn().then(function (s) {
      if (s && s.status === 'ready') {
        state.installStatus = 'ready';
        state.installedVersion = s.installedVersion;
        $('installLead').textContent = '安裝完成，已註冊並啟用。';
        $('btnToDone').disabled = false;
        renderStages();
        buildDone(true);
      } else if (s && s.status === 'disabled') {
        state.installStatus = 'ready';
        $('installLead').textContent = '已記錄為「不安裝」。';
        $('btnToDone').disabled = false;
        buildDone(false);
      } else {
        failInstall(s && s.lastError, s && s.failedStage);
      }
    }).catch(function (e) {
      failInstall(e && e.message ? e.message : String(e), null);
    }).finally(renderSideStates);
  }

  function failInstall(lastError, failedStage) {
    state.installStatus = 'failed';
    state.lastError = lastError || '未知原因';
    state.failedStage = failedStage || null;
    var stageName = STAGES.filter(function (s) { return s[0] === failedStage; })[0];
    $('installLead').textContent = '安裝沒有完成，已停在「' + (stageName ? stageName[1] : '未知步驟') + '」。已完成的步驟會保留，重試時會從中斷處續傳。';
    // lastError 格式：「代碼：技術訊息｜使用者可執行的步驟」
    var parts = String(state.lastError).split('｜');
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
    renderStages();
  }

  $('btnInstall').addEventListener('click', function () {
    if (!state.choice) return;
    var btn = $('btnInstall');
    btn.disabled = true;
    runInstall(function () { return api.localAi.installAi({ choice: state.choice }); })
      .finally(function () { btn.disabled = !state.agreed; });
  });

  $('btnRetry').addEventListener('click', function () {
    runInstall(function () { return api.localAi.repair({ action: 'retry' }); });
  });
  $('btnFailDiag').addEventListener('click', function () { show('diag'); });

  // ---- 5 完成 ----
  function buildDone(registered) {
    $('doneTitle').textContent = registered ? '已完成註冊' : '已記錄為不安裝';
    $('doneLead').textContent = registered
      ? '精讀與範圍整理會優先使用本地模型；本地模型失敗時自動改用雲端。'
      : '所有 AI 功能將使用雲端。之後仍可在這裡重新安裝。';
    var f = $('doneFacts');
    clear(f);
    if (registered && state.choice && state.plan) {
      var opt = state.plan.options.find(function (o) { return o.id === state.choice; });
      if (opt && opt.plan) {
        fact(f, '方案', opt.label);
        fact(f, '精讀模型', opt.plan.judgmentModel);
        fact(f, '回答模型', opt.plan.chatModel);
      }
      fact(f, '模組版本', state.installedVersion);
    }
    fact(f, '狀態', registered ? '已註冊並啟用' : '未安裝');
  }

  $('btnFinish').addEventListener('click', function () { api.localAi.wizardDone(); });

  // ---- 排除問題 ----
  var GROUPS = [
    ['引擎', ['engine-installed', 'engine-arch', 'engine-file', 'engine-signature']],
    ['服務與模型', ['service', 'models', 'chat']],
    ['磁碟與網路', ['disk', 'net-general', 'net-judicial']],
    ['模組與紀錄', ['module', 'recent-failure']]
  ];
  var FIX_NAMES = {
    retry: '重試安裝', 'restart-service': '重新啟動服務', 'reinstall-engine': '安裝或重新安裝引擎',
    'redownload-installer': '重新下載引擎', 'repull-models': '重新下載模型', reregister: '重新註冊',
    'free-disk-space': '說明', 'check-network-vpn': '說明'
  };
  var TONE = { pass: '通過', warn: '警告', fail: '失敗' };

  function runDiagnose() {
    $('diagSummary').textContent = '檢查中…';
    $('diagSummary').className = 'wiz-summary';
    api.localAi.diagnose().then(renderDiagnosis).catch(function (e) {
      $('diagSummary').textContent = '檢查失敗：' + (e && e.message ? e.message : e);
      $('diagSummary').className = 'wiz-summary error';
    });
  }

  function renderDiagnosis(s) {
    var sum = $('diagSummary');
    var counts = { pass: 0, warn: 0, fail: 0 };
    s.checks.forEach(function (c) { counts[c.status]++; });
    clear(sum);
    var msg = s.overall === 'pass' ? '一切正常' : s.overall === 'warn' ? '可以使用，但有 ' + counts.warn + ' 項需要注意' : '有 ' + counts.fail + ' 項失敗，請依說明修復';
    sum.className = 'wiz-summary ' + (s.overall === 'pass' ? 'ok' : s.overall === 'fail' ? 'error' : '');
    sum.appendChild(h('span', TONE[s.overall], 'wiz-pill ' + (s.overall === 'pass' ? 'pass' : s.overall === 'fail' ? 'fail' : 'warn')));
    sum.appendChild(h('span', msg, 'wiz-summary-text'));
    sum.appendChild(h('span', '通過 ' + counts.pass + '　警告 ' + counts.warn + '　失敗 ' + counts.fail, 'wiz-summary-count'));

    var box = $('diagGroups');
    clear(box);
    var byId = {};
    s.checks.forEach(function (c) { byId[c.id] = c; });
    var used = {};
    GROUPS.forEach(function (g) {
      var items = g[1].map(function (id) { used[id] = true; return byId[id]; }).filter(Boolean);
      if (!items.length) return;
      var sec = h('section', null, 'wiz-group');
      sec.appendChild(h('h2', g[0], 'wiz-h2'));
      var ul = h('ul', null, 'wiz-rows');
      items.forEach(function (c) { ul.appendChild(checkRow(c)); });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
    var rest = s.checks.filter(function (c) { return !used[c.id]; });
    if (rest.length) {
      var sec2 = h('section', null, 'wiz-group');
      sec2.appendChild(h('h2', '其他', 'wiz-h2'));
      var ul2 = h('ul', null, 'wiz-rows');
      rest.forEach(function (c) { ul2.appendChild(checkRow(c)); });
      sec2.appendChild(ul2);
      box.appendChild(sec2);
    }
  }

  function checkRow(c) {
    var li = h('li', null, 'wiz-row ' + c.status);
    var body = h('div', null, 'wiz-row-body');
    body.appendChild(h('div', c.title, 'wiz-row-title'));
    body.appendChild(h('div', c.detail, 'wiz-row-detail'));
    li.appendChild(body);
    var side = h('div', null, 'wiz-row-side');
    side.appendChild(h('span', TONE[c.status], 'wiz-pill ' + (c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'fail' : 'warn')));
    if (c.fix && FIX_NAMES[c.fix] && c.fix !== 'free-disk-space' && c.fix !== 'check-network-vpn') {
      var b = h('button', FIX_NAMES[c.fix], 'btn');
      b.type = 'button';
      b.addEventListener('click', function () { fixFromDiag(c.fix, b); });
      side.appendChild(b);
    }
    li.appendChild(side);
    return li;
  }

  function fixFromDiag(action, btn) {
    btn.disabled = true;
    $('diagMsg').textContent = '執行修復：' + (FIX_NAMES[action] || action) + '…';
    $('diagMsg').className = 'status';
    api.localAi.repair({ action: action }).then(function () {
      $('diagMsg').textContent = '修復完成，重新檢查中。';
      $('diagMsg').className = 'status ok';
      runDiagnose();
    }).catch(function (e) {
      $('diagMsg').textContent = '修復沒有成功：' + (e && e.message ? e.message : e);
      $('diagMsg').className = 'status error';
      btn.disabled = false;
    });
  }

  $('btnDiagRun').addEventListener('click', runDiagnose);
  $('btnDiagExport').addEventListener('click', function () {
    api.localAi.exportReport().then(function (p) {
      $('diagMsg').textContent = '已匯出：' + p;
      $('diagMsg').className = 'status ok';
    }).catch(function (e) {
      $('diagMsg').textContent = '匯出失敗：' + (e && e.message ? e.message : e);
      $('diagMsg').className = 'status error';
    });
  });

  // ---- 模組與更新 ----
  var MOD_NAMES = { 'ai-engine': 'AI 引擎模組', crawler: '爬取模組' };
  var MOD_STATUS = { 'not-installed': ['尚未安裝', ''], installing: ['安裝中', 'warn'], ready: ['已啟用', 'pass'], failed: ['安裝失敗', 'fail'], disabled: ['不安裝', 'warn'] };
  var pendingApply = false;

  function refreshModules() {
    api.localAi.modules().then(function (reg) {
      var ai = reg['ai-engine'];
      var cr = reg.crawler;
      setPill($('modAiPill'), MOD_STATUS[ai.status][0], MOD_STATUS[ai.status][1]);
      setPill($('modCrPill'), MOD_STATUS[cr.status][0], MOD_STATUS[cr.status][1]);
      var fa = $('modAiFacts'); clear(fa);
      fact(fa, '已安裝版本', ai.installedVersion);
      fact(fa, '最近錯誤', ai.lastError ? ai.lastError.split('｜')[0] : '無');
      var fc = $('modCrFacts'); clear(fc);
      fact(fc, '已安裝版本', cr.installedVersion);
      fact(fc, '最近錯誤', cr.lastError || '無');
    });
  }

  $('crawlerInstall').addEventListener('click', function () {
    var btn = $('crawlerInstall');
    btn.disabled = true;
    api.localAi.installCrawler().then(function () { refreshModules(); }).catch(function (e) {
      $('updMsg').textContent = '爬取模組安裝失敗：' + (e && e.message ? e.message : e);
      $('updMsg').className = 'status error';
    }).finally(function () { btn.disabled = false; });
  });

  $('btnUpdCheck').addEventListener('click', function () {
    $('updSummary').textContent = '檢查中…';
    $('updSummary').className = 'wiz-summary';
    api.localAi.checkUpdates().then(function (r) {
      var rows = $('updRows');
      clear(rows);
      if (!r.ok) {
        $('updSummary').textContent = '無法檢查更新：' + r.error;
        $('updSummary').className = 'wiz-summary error';
        pendingApply = false;
        $('btnUpdApply').disabled = true;
        return;
      }
      r.plans.forEach(function (p) {
        var li = h('li', null, 'wiz-row');
        var body = h('div', null, 'wiz-row-body');
        body.appendChild(h('div', MOD_NAMES[p.moduleId] || p.moduleId, 'wiz-row-title'));
        var detail = p.upToDate ? '已是最新版本 ' + p.toVersion
          : p.requiresAppUpdate ? '版本 ' + p.toVersion + ' 需要更新應用程式'
          : (p.fromVersion || '未安裝') + ' → ' + p.toVersion + '；需下載 ' + p.download.length + ' 個檔案，沿用 ' + p.reuse.length + ' 個';
        body.appendChild(h('div', detail, 'wiz-row-detail'));
        li.appendChild(body);
        var tone = p.upToDate ? 'pass' : p.requiresAppUpdate ? 'fail' : 'warn';
        li.appendChild(h('span', p.upToDate ? '最新' : p.requiresAppUpdate ? '需升級程式' : '有更新', 'wiz-pill ' + tone));
        rows.appendChild(li);
      });
      var anyChange = r.plans.some(function (p) { return !p.upToDate && !p.requiresAppUpdate; });
      $('updSummary').textContent = anyChange ? '有可套用的更新。' : '目前沒有可套用的更新。';
      $('updSummary').className = 'wiz-summary ' + (anyChange ? '' : 'ok');
      pendingApply = anyChange;
      $('btnUpdApply').disabled = !anyChange;
    }).catch(function (e) {
      $('updSummary').textContent = '檢查失敗：' + (e && e.message ? e.message : e);
      $('updSummary').className = 'wiz-summary error';
    });
  });

  $('btnUpdApply').addEventListener('click', function () {
    var btn = $('btnUpdApply');
    btn.disabled = true;
    $('updMsg').textContent = '套用中…';
    $('updMsg').className = 'status';
    api.localAi.applyUpdates().then(function (r) {
      var rows = $('updRows');
      clear(rows);
      r.results.forEach(function (x) {
        var li = h('li', null, 'wiz-row ' + (x.ok ? 'pass' : 'fail'));
        var body = h('div', null, 'wiz-row-body');
        body.appendChild(h('div', MOD_NAMES[x.module] || x.module, 'wiz-row-title'));
        body.appendChild(h('div', x.message, 'wiz-row-detail'));
        li.appendChild(body);
        li.appendChild(h('span', x.ok ? '完成' : '失敗', 'wiz-pill ' + (x.ok ? 'pass' : 'fail')));
        rows.appendChild(li);
      });
      var allOk = r.results.every(function (x) { return x.ok; });
      $('updSummary').textContent = allOk ? '更新已套用。' : '部分模組沒有更新成功，已保留原本的版本。';
      $('updSummary').className = 'wiz-summary ' + (allOk ? 'ok' : 'error');
      $('updMsg').textContent = '';
      refreshModules();
    }).catch(function (e) {
      $('updMsg').textContent = '更新失敗：' + (e && e.message ? e.message : e);
      $('updMsg').className = 'status error';
    }).finally(function () { btn.disabled = !pendingApply; });
  });

  // ---- 啟動 ----
  var startView = new URLSearchParams(window.location.search).get('view');
  resetStages();
  renderStages();
  show(startView === 'diag' ? 'diag' : 'check');
})();
