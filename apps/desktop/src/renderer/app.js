// 渲染程序：只透過 window.api（preload 暴露的 IPC）與主程序溝通，不直接接觸檔案或網路。
(function () {
  'use strict';
  var api = window.api;
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    listItems: null, listDetails: null, listKeyword: '',
    brief: null, briefPick: null,
    scopeSheets: null, scopeFrom: null, scopeTo: null,
    fileTab: 'active',
    assistHistory: []
  };
  var KIND_LABEL = { list: '判決列表', scope: '範圍整理', brief: '單一判決' };

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
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
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
    if (name === 'files') loadFiles();
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
  // 列表表頭另在 index.html 補上「操作」欄
  function renderList(items) {
    var body = $('listBody');
    body.innerHTML = '';
    items.forEach(function (it, i) {
      var tr = document.createElement('tr');
      [String(i + 1), it.title, it.dateIso || it.dateDisplay || '', it.cause || ''].forEach(function (text, j) {
        var td = document.createElement('td');
        if (j === 0) td.className = 'num';
        td.textContent = text;
        tr.appendChild(td);
      });
      var bt = el('td');
      var b = el('button', 'btn small', '精讀這則');
      b.type = 'button';
      b.addEventListener('click', function () { briefFor(it); });
      bt.appendChild(b);
      tr.appendChild(bt);
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
      setStatus($('listStatus'), r.items.length ? '找到 ' + r.items.length + ' 筆，已存入「檔案」。' : '沒有找到符合的判決，請換個關鍵字再試。', r.items.length ? 'ok' : '');
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
  function statuteLines() {
    return $('scopeLines').value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function renderScope(sheets) {
    var box = $('scopeResult');
    box.innerHTML = '';
    sheets.forEach(function (sh) {
      var block = el('div', 'scope-block');
      block.appendChild(el('h2', '', sh.statute + '（' + sh.rows.length + ' 筆）'));
      if (sh.rows.length === 0) {
        block.appendChild(el('p', 'hint', '沒有找到確實引用此法規（或此條文）的判決。'));
        box.appendChild(block);
        return;
      }
      if (sh.synthesis) {
        var syn = el('div', 'synthesis');
        var parts = [['綜合概述', sh.synthesis.overview], ['趨勢與分歧', sh.synthesis.trends], ['研究結論', sh.synthesis.conclusion]];
        parts.forEach(function (p) {
          var t = el('p');
          t.appendChild(el('strong', '', p[0] + '：'));
          t.appendChild(document.createTextNode(p[1] || ''));
          syn.appendChild(t);
        });
        block.appendChild(syn);
      }
      var wrap = el('div', 'table-wrap');
      var table = el('table', 'table');
      table.innerHTML = '<thead><tr><th>序號</th><th>裁判字號</th><th>裁判日期</th><th>類型</th><th>爭點</th><th>法院見解</th><th>結論</th><th>引用條文</th><th>法條異動</th><th>操作</th></tr></thead>';
      var tbody = el('tbody');
      var byId = {};
      (sh.analyses || []).forEach(function (a) { byId[a.id] = a; });
      sh.rows.forEach(function (r, i) {
        var a = byId[r.id] || {};
        var notes = (r.lawNotes || []).map(function (n) { return n.summary; }).join('\n');
        var tr = el('tr');
        [String(i + 1), r.title, r.dateIso || '', a.group || '', a.issue || '', a.holding || '', a.outcome || '', r.citedArticles.join('；'), notes].forEach(function (text, j) {
          var td = el('td', j === 0 ? 'num' : '', text);
          tr.appendChild(td);
        });
        var bt = el('td');
        var b = el('button', 'btn small', '精讀這則');
        b.type = 'button';
        b.addEventListener('click', function () { briefFor(r); });
        bt.appendChild(b);
        tr.appendChild(bt);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      block.appendChild(wrap);
      box.appendChild(block);
    });
  }

  $('scopeForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var statutes = statuteLines();
    if (statutes.length === 0) {
      setStatus($('scopeStatus'), '請至少輸入一部法規。', 'error');
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
    setStatus($('scopeStatus'), '確認法名中…（每則判決都會交由 AI 分析）');
    try {
      var r = await api.scope.run({ statutes: statutes, yearFrom: from, yearTo: to, maxItems: max });
      state.scopeSheets = r.sheets;
      state.scopeFrom = from;
      state.scopeTo = to;
      renderScope(r.sheets);
      var total = r.sheets.reduce(function (n, s) { return n + s.rows.length; }, 0);
      setStatus($('scopeStatus'), '完成，共 ' + total + ' 筆，已存入「檔案」。', 'ok');
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
    setStatus($('scopeStatus'), '「' + p.statute + '」' + p.phase + '：' + p.done + ' / ' + p.total);
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

  // ---- 單一判決：先找候選，再鎖定一則 ----
  function briefFor(item) {
    setPick({ id: item.id, title: item.title, dateIso: item.dateIso || item.dateDisplay || '' });
    setStatus($('briefStatus'), '已從上一頁帶入這則判決，可以直接整理。', 'ok');
    showPage('brief');
  }
  function setPick(item) {
    state.briefPick = item;
    $('briefPicked').textContent = item ? (item.title + '（' + (item.dateIso || item.dateDisplay || '') + '）') : '尚未選定';
    $('briefRun').disabled = !item;
  }
  function renderCandidates(items) {
    var body = $('briefCandidateBody');
    body.innerHTML = '';
    items.forEach(function (it, i) {
      var tr = el('tr');
      [String(i + 1), it.title, it.dateIso || it.dateDisplay || '', it.cause || ''].forEach(function (text, j) {
        tr.appendChild(el('td', j === 0 ? 'num' : '', text));
      });
      var td = el('td');
      var pick = el('button', 'btn small', '選定這則');
      pick.type = 'button';
      pick.addEventListener('click', function () {
        setPick(it);
        setStatus($('briefStatus'), '已選定，可以整理這則判決。', 'ok');
      });
      td.appendChild(pick);
      tr.appendChild(td);
      body.appendChild(tr);
    });
    $('briefCandidates').hidden = items.length === 0;
  }
  $('briefFindForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    $('briefFind').disabled = true;
    setStatus($('briefFindStatus'), '搜尋中…');
    try {
      var r = await api.judgment.find({ query: $('briefQuery').value.trim() });
      renderCandidates(r.items);
      setStatus($('briefFindStatus'), r.items.length ? '找到 ' + r.items.length + ' 筆候選，請選定一則。' : '沒有找到符合的判決。可以換個關鍵字，或使用縮寫。', r.items.length ? 'ok' : '');
    } catch (err) {
      setStatus($('briefFindStatus'), '搜尋失敗：' + errText(err), 'error');
    } finally {
      $('briefFind').disabled = false;
    }
  });

  function renderBrief(view) {
    var d = view.detail;
    var doc = view.doc;
    var box = $('briefView');
    box.innerHTML = '';
    box.appendChild(el('h2', '', doc.title || d.meta.title || d.meta.id));
    box.appendChild(el('p', '', '法院：' + (d.meta.court || '—') + '　日期：' + (d.meta.dateIso || d.meta.dateMinguo || '—') + '　案由：' + (d.meta.cause || '—')));
    doc.sections.forEach(function (sec) {
      box.appendChild(el('h3', '', sec.heading));
      sec.paragraphs.forEach(function (text) { box.appendChild(el('p', '', text)); });
    });
    box.appendChild(el('h3', '', '原判決主文'));
    (d.sections['主文'] || '').split(/\n+/).filter(Boolean).forEach(function (line) {
      var p = el('p');
      var m = el('mark', '', line);
      p.appendChild(m);
      box.appendChild(p);
    });
    box.hidden = false;
  }
  $('briefForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!state.briefPick) {
      setStatus($('briefStatus'), '請先在候選中選定一則判決。', 'error');
      return;
    }
    $('briefRun').disabled = true;
    $('briefExport').disabled = true;
    setStatus($('briefStatus'), '讀取判決中…');
    try {
      var r = await api.brief.run({
        judgmentId: state.briefPick.id,
        focus: $('briefFocus').value.trim(),
        lengthHint: $('briefLength').value
      });
      state.brief = r;
      renderBrief(r);
      setStatus($('briefStatus'), '已完成 AI 整理，已存入「檔案」。', 'ok');
      $('briefExport').disabled = false;
    } catch (err) {
      setStatus($('briefStatus'), '讀取失敗：' + errText(err), 'error');
    } finally {
      $('briefRun').disabled = !state.briefPick;
    }
  });
  $('briefExport').addEventListener('click', async function () {
    if (!state.brief) return;
    try {
      var r = await api.brief.export({ detail: state.brief.detail, doc: state.brief.doc });
      if (!r.canceled) setStatus($('briefStatus'), '已匯出：' + r.filePath, 'ok');
    } catch (err) {
      setStatus($('briefStatus'), '匯出失敗：' + errText(err), 'error');
    }
  });

  // ---- 檔案 ----
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      state.fileTab = t.dataset.tab;
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      loadFiles();
    });
  });

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString('zh-TW', { hour12: false }); } catch (e) { return iso; }
  }

  async function loadFiles() {
    var list = $('fileList');
    list.innerHTML = '';
    try {
      var items = await api.library.list({ status: state.fileTab });
      setStatus($('filesStatus'), items.length ? '' : '這裡沒有項目。');
      items.forEach(function (it) { list.appendChild(fileRow(it)); });
    } catch (err) {
      setStatus($('filesStatus'), '讀取失敗：' + errText(err), 'error');
    }
  }

  function fileRow(it) {
    var li = el('li', 'file-item');
    var head = el('div', 'file-head');
    head.appendChild(el('span', 'file-kind', KIND_LABEL[it.kind] || it.kind));
    head.appendChild(el('span', 'file-title', (it.starred ? '★ ' : '') + it.title));
    li.appendChild(head);
    li.appendChild(el('p', 'file-meta', fmtTime(it.createdAt) + '　' + it.summary));

    var acts = el('div', 'actions file-actions');
    function btn(label, fn, cls) {
      var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      b.addEventListener('click', fn);
      acts.appendChild(b);
      return b;
    }
    async function patch(p) {
      try {
        await api.library.update({ id: it.id, patch: p });
        loadFiles();
      } catch (err) {
        setStatus($('filesStatus'), '更新失敗：' + errText(err), 'error');
      }
    }

    if (state.fileTab !== 'trashed') {
      btn('開啟', function () { openItem(it); });
      btn(it.starred ? '取消星號' : '加星號', function () { patch({ starred: !it.starred }); });
    }
    if (state.fileTab === 'active') {
      btn('封存', function () { patch({ status: 'archived' }); });
      btn('移入垃圾桶', function () { patch({ status: 'trashed' }); });
    } else if (state.fileTab === 'archived') {
      btn('還原', function () { patch({ status: 'active' }); });
      btn('移入垃圾桶', function () { patch({ status: 'trashed' }); });
    } else {
      btn('還原', function () { patch({ status: 'active' }); });
      var del = btn('永久刪除', function () {
        if (del.dataset.armed !== '1') {
          del.dataset.armed = '1';
          del.textContent = '再按一次確認刪除';
          return;
        }
        api.library.remove({ id: it.id }).then(function () { loadFiles(); });
      }, 'danger');
    }
    li.appendChild(acts);
    return li;
  }

  function openItem(it) {
    var p = it.payload || {};
    if (it.kind === 'list') {
      state.listItems = p.items || [];
      state.listDetails = p.details || {};
      state.listKeyword = p.keyword || '';
      renderList(state.listItems);
      $('listKeyword').value = state.listKeyword;
      $('listExport').disabled = state.listItems.length === 0;
      setStatus($('listStatus'), '已從「檔案」開啟。', 'ok');
      showPage('list');
    } else if (it.kind === 'scope') {
      state.scopeSheets = p.sheets || [];
      state.scopeFrom = p.yearFrom;
      state.scopeTo = p.yearTo;
      renderScope(state.scopeSheets);
      $('scopeXlsx').disabled = false;
      $('scopeDocx').disabled = false;
      setStatus($('scopeStatus'), '已從「檔案」開啟。', 'ok');
      showPage('scope');
    } else if (it.kind === 'brief') {
      state.brief = p;
      renderBrief(p);
      $('briefExport').disabled = false;
      setStatus($('briefStatus'), '已從「檔案」開啟。', 'ok');
      showPage('brief');
    }
  }

  // ---- 懸浮 AI 助理 ----
  function setPanel(open) {
    $('assistPanel').hidden = !open;
    $('assistFab').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('assistText').focus();
  }
  $('assistFab').addEventListener('click', function () { setPanel($('assistPanel').hidden); });
  $('assistClose').addEventListener('click', function () { setPanel(false); });
  $('assistClear').addEventListener('click', function () {
    state.assistHistory = [];
    $('assistLog').innerHTML = '';
  });

  function addMsg(role, text) {
    var m = el('div', 'assist-msg ' + role);
    m.appendChild(el('div', 'assist-who', role === 'user' ? '您' : '助理'));
    m.appendChild(el('div', 'assist-text', text));
    $('assistLog').appendChild(m);
    $('assistLog').scrollTop = $('assistLog').scrollHeight;
    return m;
  }

  function addPending(p) {
    var card = el('div', 'assist-confirm');
    card.appendChild(el('p', '', '待確認：' + p.label));
    card.appendChild(el('p', 'hint', '這個操作會呼叫 AI 或改動資料，需要您同意才會執行。'));
    var row = el('div', 'actions');
    var ok = el('button', 'btn small primary', '同意執行');
    ok.type = 'button';
    var no = el('button', 'btn small', '略過');
    no.type = 'button';
    ok.addEventListener('click', function () {
      ok.disabled = true; no.disabled = true;
      card.appendChild(el('p', 'hint', '已同意，開始執行。'));
      runPending(p);
    });
    no.addEventListener('click', function () {
      ok.disabled = true; no.disabled = true;
      card.appendChild(el('p', 'hint', '已略過。'));
    });
    row.appendChild(ok);
    row.appendChild(no);
    card.appendChild(row);
    $('assistLog').appendChild(card);
    $('assistLog').scrollTop = $('assistLog').scrollHeight;
  }

  function runPending(p) {
    if (p.kind === 'run_scope') {
      showPage('scope');
      $('scopeLines').value = (p.args.statutes || []).join('\n');
      $('scopeFrom').value = p.args.yearFrom || '';
      $('scopeTo').value = p.args.yearTo || '';
      $('scopeForm').dispatchEvent(new Event('submit', { cancelable: true }));
    } else if (p.kind === 'run_brief') {
      showPage('brief');
      setPick({ id: p.args.judgmentId, title: p.args.judgmentId, dateIso: '' });
      $('briefFocus').value = p.args.focus || '';
      $('briefForm').dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }

  $('assistForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var text = $('assistText').value.trim();
    if (!text) return;
    $('assistText').value = '';
    addMsg('user', text);
    var thinking = addMsg('assistant', '思考中…');
    $('assistSend').disabled = true;
    try {
      var turn = await api.assistant.chat({ history: state.assistHistory, text: text });
      thinking.querySelector('.assist-text').textContent = turn.reply;
      state.assistHistory.push({ role: 'user', text: text });
      state.assistHistory.push({ role: 'assistant', text: turn.reply });
      if (turn.navigate) showPage(turn.navigate);
      (turn.pending || []).forEach(addPending);
    } catch (err) {
      thinking.querySelector('.assist-text').textContent = '無法回應：' + errText(err);
      thinking.classList.add('error');
    } finally {
      $('assistSend').disabled = false;
    }
  });
  $('assistText').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      $('assistForm').dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  api.appInfo().then(function (info) {
    $('versionInfo').textContent = '版本 ' + info.version + (info.packaged ? '' : '（開發版）');
  });
  loadSettings();
})();
