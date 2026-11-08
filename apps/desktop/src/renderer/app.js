// 渲染程序：只透過 window.api（preload 暴露的 IPC）與主程序溝通，不直接接觸檔案或網路。
(function () {
  'use strict';
  var api = window.api;
  var $ = function (id) { return document.getElementById(id); };
  var state = { listItems: null, listDetails: null, listKeyword: '', brief: null, scopeSheets: null, scopeFrom: null, scopeTo: null };

  // 預設的法規清單（來自既有的判決整理表）；使用者可多選，也可自行輸入其他法規。
  var PRESET_STATUTES = [
    '二二八事件處理及補償條例',
    '戒嚴時期不當叛亂暨匪諜審判案件補償條例',
    '戒嚴時期人民受損權利回復條例',
    '政治檔案及促進轉型正義條例',
    '民法'
  ];

  function setStatus(el, msg, kind) {
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function errText(err) {
    var m = err && err.message ? err.message : String(err);
    return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  function notice(msg) {
    var n = $('notice');
    n.textContent = msg;
    n.hidden = false;
    setTimeout(function () { n.hidden = true; }, 6000);
  }

  // ---- 視窗控制 ----
  document.querySelectorAll('[data-win]').forEach(function (b) {
    b.addEventListener('click', function () { api.win[b.dataset.win](); });
  });

  // ---- 深色模式 ----
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('themeToggle').checked = dark;
  }
  var saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* 忽略 */ }
  applyTheme(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  $('themeToggle').addEventListener('change', function () {
    var dark = $('themeToggle').checked;
    applyTheme(dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) { /* 忽略 */ }
  });

  // ---- 頁面切換 ----
  function showPage(name) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + name); });
    document.querySelectorAll('.rail-item').forEach(function (n) { n.classList.toggle('active', n.dataset.page === name); });
    if (name === 'settings') loadSettings();
  }
  document.querySelectorAll('[data-page]').forEach(function (b) {
    b.addEventListener('click', function () { showPage(b.dataset.page); });
  });
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { showPage(b.dataset.go); });
  });

  // ---- 設定 ----
  var PROVIDER_DEFAULTS = {
    anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
    'openai-compatible': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
  };
  async function loadSettings() {
    var s = await api.settings.get();
    $('setProvider').value = s.aiProvider;
    $('setBaseUrl').value = s.aiBaseUrl;
    $('setModel').value = s.aiModel;
    $('keyState').textContent = s.hasKey ? '（已設定）' : '（尚未設定）';
    $('setCacheDays').value = s.cacheDays;
    $('listMax').value = s.defaultMaxItems;
  }
  $('setProvider').addEventListener('change', function () {
    var d = PROVIDER_DEFAULTS[$('setProvider').value];
    $('setBaseUrl').value = d.baseUrl;
    $('setModel').value = d.model;
  });
  $('settingsForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var patch = {
      aiProvider: $('setProvider').value,
      aiBaseUrl: $('setBaseUrl').value.trim(),
      aiModel: $('setModel').value.trim(),
      cacheDays: Number($('setCacheDays').value) || 7
    };
    var key = $('setKey').value.trim();
    if (key) patch.apiKey = key;
    try {
      await api.settings.set(patch);
      $('setKey').value = '';
      setStatus($('setStatus'), '已儲存。', 'ok');
      loadSettings();
    } catch (err) {
      setStatus($('setStatus'), '儲存失敗：' + errText(err), 'error');
    }
  });
  $('setTest').addEventListener('click', async function () {
    setStatus($('setStatus'), '測試中…');
    try {
      var r = await api.settings.test();
      setStatus($('setStatus'), '連線成功，回覆：' + r.reply, 'ok');
    } catch (err) {
      setStatus($('setStatus'), '連線失敗：' + errText(err), 'error');
    }
  });
  $('setClear').addEventListener('click', async function () {
    await api.settings.set({ clearKey: true });
    setStatus($('setStatus'), '已清除金鑰。', 'ok');
    loadSettings();
  });
  $('cacheClear').addEventListener('click', async function () {
    await api.cache.clear();
    notice('本機快取已清除。');
  });
  $('openUpdater').addEventListener('click', async function () {
    var ok = await api.update.openUpdater();
    notice(ok ? '已開啟更新程式。' : '此為開發版本，無法檢查更新。');
  });

  // ---- 判決列表 ----
  function renderList(items) {
    var body = $('listBody');
    body.innerHTML = '';
    items.forEach(function (it, i) {
      var tr = document.createElement('tr');
      [String(i + 1), it.title, it.date_iso || '', it.cause || ''].forEach(function (text, j) {
        var td = document.createElement('td');
        if (j === 0) td.className = 'num';
        td.textContent = text;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $('listResult').hidden = items.length === 0;
  }
  $('listForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var keyword = $('listKeyword').value.trim();
    var full = $('listFull').checked;
    var progress = $('listProgress');
    $('listRun').disabled = true;
    $('listExport').disabled = true;
    setStatus($('listStatus'), '搜尋中…');
    progress.hidden = !full;
    progress.querySelector('.bar').style.width = '0%';
    try {
      var r = await api.search.run({
        keyword: keyword,
        courtCode: $('listCourt').value.trim(),
        maxItems: Number($('listMax').value) || 20,
        includeFullText: full
      });
      state.listItems = r.items;
      state.listDetails = r.details;
      state.listKeyword = keyword;
      renderList(r.items);
      setStatus($('listStatus'), r.items.length ? '找到 ' + r.items.length + ' 筆。' : '沒有找到符合的判決，請換個關鍵字再試。', r.items.length ? 'ok' : '');
      $('listExport').disabled = r.items.length === 0;
    } catch (err) {
      setStatus($('listStatus'), '搜尋失敗：' + errText(err), 'error');
    } finally {
      $('listRun').disabled = false;
      progress.hidden = true;
    }
  });
  api.search.onProgress(function (p) {
    $('listProgress').querySelector('.bar').style.width = Math.round((p.done / p.total) * 100) + '%';
  });
  $('listExport').addEventListener('click', async function () {
    try {
      var r = await api.exportList({ keyword: state.listKeyword, items: state.listItems, details: state.listDetails || {} });
      if (!r.canceled) setStatus($('listStatus'), '已匯出：' + r.filePath, 'ok');
    } catch (err) {
      setStatus($('listStatus'), '匯出失敗：' + errText(err), 'error');
    }
  });

  // ---- 範圍整理表 ----
  function buildPresets() {
    var box = $('scopePresets');
    PRESET_STATUTES.forEach(function (name, i) {
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = name;
      cb.id = 'preset' + i;
      if (i < 3) cb.checked = true;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(name));
      box.appendChild(label);
    });
  }
  buildPresets();

  function selectedStatutes() {
    var names = [];
    document.querySelectorAll('#scopePresets input:checked').forEach(function (cb) { names.push(cb.value); });
    $('scopeCustom').value.split(/\n/).forEach(function (line) {
      var t = line.trim();
      if (t && names.indexOf(t) < 0) names.push(t);
    });
    return names;
  }

  function renderScope(sheets) {
    var box = $('scopeResult');
    box.innerHTML = '';
    sheets.forEach(function (sh) {
      var block = document.createElement('div');
      block.className = 'scope-block';
      var h = document.createElement('h2');
      h.textContent = sh.statute + '（' + sh.rows.length + ' 筆）';
      block.appendChild(h);
      if (sh.rows.length === 0) {
        var none = document.createElement('p');
        none.className = 'hint';
        none.textContent = '沒有找到確實引用此法規的判決。';
        block.appendChild(none);
      } else {
        var wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        var table = document.createElement('table');
        table.className = 'table';
        table.innerHTML = '<thead><tr><th>序號</th><th>裁判字號</th><th>法院</th><th>裁判日期</th><th>案由</th><th>主文（結果）</th><th>引用條文</th></tr></thead>';
        var tbody = document.createElement('tbody');
        sh.rows.forEach(function (r, i) {
          var tr = document.createElement('tr');
          [String(i + 1), r.title, r.court || '', r.dateIso || '', r.cause, r.result, r.citedArticles.join('；')].forEach(function (text, j) {
            var td = document.createElement('td');
            if (j === 0) td.className = 'num';
            td.textContent = text;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        block.appendChild(wrap);
      }
      box.appendChild(block);
    });
  }

  $('scopeForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var statutes = selectedStatutes();
    if (statutes.length === 0) {
      setStatus($('scopeStatus'), '請至少選擇一部法規。', 'error');
      return;
    }
    var from = Number($('scopeFrom').value) || undefined;
    var to = Number($('scopeTo').value) || undefined;
    var max = Number($('scopeMax').value) || 30;
    $('scopeRun').disabled = true;
    $('scopeXlsx').disabled = true;
    $('scopeDocx').disabled = true;
    $('scopeResult').innerHTML = '';
    $('scopeProgress').hidden = false;
    setStatus($('scopeStatus'), '整理中，請稍候…');
    try {
      var r = await api.scope.run({ statutes: statutes, yearFrom: from, yearTo: to, maxItems: max });
      state.scopeSheets = r.sheets;
      state.scopeFrom = from;
      state.scopeTo = to;
      renderScope(r.sheets);
      var total = r.sheets.reduce(function (n, s) { return n + s.rows.length; }, 0);
      setStatus($('scopeStatus'), '完成，共 ' + total + ' 筆。', 'ok');
      $('scopeXlsx').disabled = false;
      $('scopeDocx').disabled = false;
    } catch (err) {
      setStatus($('scopeStatus'), '整理失敗：' + errText(err), 'error');
    } finally {
      $('scopeRun').disabled = false;
      $('scopeProgress').hidden = true;
    }
  });
  api.scope.onProgress(function (p) {
    $('scopeProgress').querySelector('.bar').style.width = Math.round((p.done / Math.max(p.total, 1)) * 100) + '%';
    setStatus($('scopeStatus'), '正在整理「' + p.statute + '」：' + p.done + ' / ' + p.total);
  });
  async function exportScope(format) {
    if (!state.scopeSheets) return;
    try {
      var r = await api.scope.export({ sheets: state.scopeSheets, yearFrom: state.scopeFrom, yearTo: state.scopeTo, format: format });
      if (!r.canceled) setStatus($('scopeStatus'), '已匯出：' + r.filePath, 'ok');
    } catch (err) {
      setStatus($('scopeStatus'), '匯出失敗：' + errText(err), 'error');
    }
  }
  $('scopeXlsx').addEventListener('click', function () { exportScope('xlsx'); });
  $('scopeDocx').addEventListener('click', function () { exportScope('docx'); });

  // ---- 單一判決精讀 ----
  function renderBrief(view) {
    var d = view.detail;
    var box = $('briefView');
    box.innerHTML = '';
    var h = document.createElement('h2');
    h.textContent = d.meta.title || d.meta.id;
    box.appendChild(h);
    var meta = document.createElement('p');
    meta.textContent = '法院：' + (d.meta.court || '—') + '　日期：' + (d.meta.dateIso || d.meta.dateMinguo || '—') + '　案由：' + (d.meta.cause || '—');
    box.appendChild(meta);
    if (view.summary) {
      var sh = document.createElement('h3'); sh.textContent = '摘要'; box.appendChild(sh);
      view.summary.split(/\n+/).forEach(function (line) {
        var p = document.createElement('p'); p.textContent = line; box.appendChild(p);
      });
    }
    var oh = document.createElement('h3'); oh.textContent = '原文'; box.appendChild(oh);
    Object.keys(d.sections).forEach(function (name) {
      var nh = document.createElement('h3'); nh.textContent = name; box.appendChild(nh);
      (d.sections[name] || '').split(/\n+/).filter(Boolean).forEach(function (line) {
        var p = document.createElement('p');
        if (name === '主文') {
          var m = document.createElement('mark'); m.textContent = line; p.appendChild(m);
        } else {
          p.textContent = line;
        }
        box.appendChild(p);
      });
    });
    box.hidden = false;
  }
  $('briefForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    $('briefRun').disabled = true;
    $('briefExport').disabled = true;
    setStatus($('briefStatus'), '讀取判決中…');
    try {
      var r = await api.brief.run({
        judgmentId: $('briefId').value.trim(),
        focus: $('briefFocus').value.trim(),
        lengthHint: $('briefLength').value,
        useAi: $('briefAi').checked
      });
      state.brief = r;
      renderBrief(r);
      if (r.aiError) setStatus($('briefStatus'), 'AI 摘要未產生：' + r.aiError, 'error');
      else setStatus($('briefStatus'), '已讀取。', 'ok');
      $('briefExport').disabled = false;
    } catch (err) {
      setStatus($('briefStatus'), '讀取失敗：' + errText(err), 'error');
    } finally {
      $('briefRun').disabled = false;
    }
  });
  $('briefExport').addEventListener('click', async function () {
    if (!state.brief) return;
    try {
      var r = await api.brief.export({ detail: state.brief.detail, summary: state.brief.summary });
      if (!r.canceled) setStatus($('briefStatus'), '已匯出：' + r.filePath, 'ok');
    } catch (err) {
      setStatus($('briefStatus'), '匯出失敗：' + errText(err), 'error');
    }
  });

  api.appInfo().then(function (info) {
    $('versionInfo').textContent = '版本 ' + info.version + (info.packaged ? '' : '（開發版）');
  });
  loadSettings();
})();
