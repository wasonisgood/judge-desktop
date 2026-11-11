// 控制器：個案研究筆記（全文選取標注、四色螢光、單句註解、重新對位、AI 引文標注、Word 匯出）。
// 標注資料全部經由主程序（annotation:*）讀寫；畫面只做選取換算與顯示。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;

  var st = {
    target: null,       // { id, title, jurisdiction }
    view: null,         // 主程序回傳的 annotation:load 結果
    includeAi: true,
    mode: 'highlight',  // 工具列目前模式
    pending: null,      // 選取範圍（全文位置）
    editing: null,      // 正在編輯的標注 id
    judgments: [],      // 過去筆記（annotation:judgments）
    checked: {},        // 合併匯出勾選：judgmentId -> boolean
    queue: [],          // 逐案閱讀的案件（同一批列表或範圍結果）
    qIndex: -1
  };

  function updateManyButton() {
    var n = Object.keys(st.checked).filter(function (k) { return st.checked[k]; }).length;
    $('annExportMany').disabled = n === 0;
    $('annExportMany').textContent = '合併匯出勾選案件（' + n + ' 案）';
  }

  function renderNav() {
    if (st.qIndex < 0 || !st.queue.length) { JR.views.renderAnnNav(null); return; }
    JR.views.renderAnnNav({ index: st.qIndex, total: st.queue.length, title: st.queue[st.qIndex].title });
  }

  /** 上一案／下一案：切換案件並自動載入全文與該案既有標注。 */
  function goQueue(delta) {
    var idx = st.qIndex + delta;
    if (idx < 0 || idx >= st.queue.length) return;
    st.qIndex = idx;
    var item = st.queue[idx];
    prepare({ id: item.id, title: item.title, jurisdiction: item.jurisdiction });
    renderNav();
    load().then(clearStatus).catch(fail);
  }

  function pickPast(id) {
    var rec = st.judgments.filter(function (r) { return r.judgmentId === id; })[0];
    if (!rec) return;
    prepare({ id: rec.judgmentId, title: rec.meta.title, jurisdiction: rec.meta.jurisdiction });
    load().then(clearStatus).catch(fail);
  }

  function saveLabels(labels) {
    api.annotation.labels.set({ labels: labels })
      .then(function () { return load(); })
      .then(function () { JR.setStatus($('annStatus'), '已儲存顏色名稱。', 'ok'); })
      .catch(fail);
  }

  /** 同步狀態與按鈕：有登入權杖才可同步。 */
  function syncRefresh() {
    return api.annotation.syncStatus().then(function (s) {
      $('annSyncNow').disabled = !s.available;
      JR.setStatus($('annSyncStatus'), s.available ? '已登入，可以同步。' : s.reason, s.available ? '' : 'error');
    }).catch(function (err) {
      $('annSyncNow').disabled = true;
      JR.setStatus($('annSyncStatus'), '無法確認同步狀態：' + JR.errText(err), 'error');
    });
  }

  function syncNow() {
    $('annSyncNow').disabled = true;
    JR.setStatus($('annSyncStatus'), '同步中…');
    api.annotation.syncNow()
      .then(function (r) {
        JR.setStatus($('annSyncStatus'), (r.merged ? '伺服器有較新的內容，已合併後同步' : '已同步') + '（版本 ' + r.revision + '，共 ' + r.annotations + ' 則標注）。', 'ok');
        return load();
      })
      .catch(function (err) { JR.setStatus($('annSyncStatus'), JR.errText(err), 'error'); })
      .then(function () { $('annSyncNow').disabled = false; });
  }

  function exportMany() {
    var targets = st.judgments
      .filter(function (r) { return st.checked[r.judgmentId]; })
      .map(function (r) { return { judgmentId: r.judgmentId, jurisdiction: r.meta.jurisdiction }; });
    if (!targets.length) { JR.setStatus($('annStatus'), '請先勾選要合併匯出的案件。', 'error'); return; }
    JR.setStatus($('annStatus'), '正在合併匯出 ' + targets.length + ' 案…');
    api.annotation.exportMany({ targets: targets })
      .then(function (r) { if (!r.canceled) JR.setStatus($('annStatus'), '已合併匯出：' + r.filePath, 'ok'); })
      .catch(fail);
  }

  function clearStatus() { JR.setStatus($('annStatus'), '', ''); }
  function fail(err) { JR.setStatus($('annStatus'), JR.errText(err), 'error'); }

  function hideToolbar() {
    st.pending = null;
    JR.views.hideAnnToolbar();
  }

  /** 選取範圍換算為全文位置：每段文字都帶有 data-s（起始位置）。 */
  function pointIndex(node, offset, len) {
    return node.nodeType === 3 ? offset : (offset > 0 ? len : 0);
  }

  function offsetsFromRange(range, reader) {
    var start = null, end = null;
    Array.prototype.forEach.call(reader.querySelectorAll('[data-s]'), function (span) {
      if (!range.intersectsNode(span)) return;
      var base = Number(span.getAttribute('data-s'));
      var len = span.textContent.length;
      var s = 0, e = len;
      if (span.contains(range.startContainer)) s = pointIndex(range.startContainer, range.startOffset, len);
      if (span.contains(range.endContainer)) e = pointIndex(range.endContainer, range.endOffset, len);
      if (e <= s) return;
      start = start === null ? base + s : Math.min(start, base + s);
      end = end === null ? base + e : Math.max(end, base + e);
    });
    return start === null || end === null || end <= start ? null : { start: start, end: end };
  }

  function onMouseUp() {
    var sel = window.getSelection();
    var reader = $('annReader');
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hideToolbar(); return; }
    var range = sel.getRangeAt(0);
    if (!reader.contains(range.commonAncestorContainer)) { hideToolbar(); return; }
    var o = offsetsFromRange(range, reader);
    if (!o || !st.view || o.end > st.view.fullText.length || !st.view.fullText.slice(o.start, o.end).trim()) { hideToolbar(); return; }
    st.pending = o;
    JR.views.showAnnToolbar(range.getBoundingClientRect(), $('annSection').getBoundingClientRect(), st.mode);
  }

  function setModeButtons() {
    Array.prototype.forEach.call($('annToolbar').querySelectorAll('[data-mode]'), function (b) {
      var on = b.getAttribute('data-mode') === st.mode;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('primary', on);
    });
  }

  function applyColor(color) {
    var p = st.pending;
    if (!p || !st.target) return;
    var mode = st.mode;
    hideToolbar();
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    api.annotation.add({
      judgmentId: st.target.id, jurisdiction: st.target.jurisdiction,
      start: p.start, end: p.end, color: color, mode: mode, note: ''
    }).then(function (ann) {
      if (ann.mode === 'highlight_note') st.editing = ann.id;
      return load();
    }).then(function () {
      JR.setStatus($('annStatus'), mode === 'highlight_note' ? '已加入螢光，請在右側輸入註解。' : '已加入螢光。', 'ok');
    }).catch(fail);
  }

  function reader(ev) {
    var mk = ev.target.closest ? ev.target.closest('mark.ann') : null;
    if (!mk) return;
    var ids = (mk.getAttribute('data-ann') || '').split(' ').filter(Boolean);
    if (!ids.length) return;
    st.editing = ids[ids.length - 1];
    renderEditor();
  }

  function renderEditor() {
    var ann = null;
    if (st.view && st.editing) {
      ann = st.view.annotations.filter(function (a) { return a.id === st.editing; })[0] || null;
      if (!ann) st.editing = null;
    }
    JR.views.renderAnnEditor(st.view || { colorLabels: {} }, ann, {
      save: saveEdit,
      remove: removeAnn,
      close: function () { st.editing = null; renderEditor(); }
    });
  }

  function saveEdit(id, patch) {
    api.annotation.update({ judgmentId: st.target.id, id: id, patch: patch })
      .then(function () { return load(); })
      .then(function () { JR.setStatus($('annStatus'), '已儲存標注與註解。', 'ok'); })
      .catch(fail);
  }

  function removeAnn(id) {
    if (!window.confirm('刪除這筆標注與註解？')) return;
    api.annotation.remove({ judgmentId: st.target.id, id: id })
      .then(function () { if (st.editing === id) st.editing = null; return load(); })
      .then(function () { JR.setStatus($('annStatus'), '已刪除。', 'ok'); })
      .catch(fail);
  }

  function reanchor(id) {
    api.annotation.reanchor({ judgmentId: st.target.id, jurisdiction: st.target.jurisdiction, id: id })
      .then(function (r) {
        return load().then(function () {
          if (r.ok) JR.setStatus($('annStatus'), '已重新對位。', 'ok');
          else JR.setStatus($('annStatus'), '無法自動對位：引用文字在新全文中找不到或出現多次。可刪除後重新標注。', 'error');
        });
      })
      .catch(fail);
  }

  function pickNote(id) {
    st.editing = id;
    renderEditor();
    var mark = $('annReader').querySelector('[data-ann~="' + id + '"]');
    if (mark) {
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
      mark.classList.add('ann-flash');
      setTimeout(function () { mark.classList.remove('ann-flash'); }, 1200);
    }
  }

  function refreshJudgments() {
    return api.annotation.judgments().then(function (list) {
      st.judgments = list;
      list.forEach(function (r) { if (st.checked[r.judgmentId] === undefined) st.checked[r.judgmentId] = true; });
      JR.views.renderAnnPast(list, st.target ? st.target.id : '', st.checked, pickPast, function (id, on) {
        st.checked[id] = on;
        updateManyButton();
      });
      updateManyButton();
    }).catch(function () { /* 列表失敗不影響標注本身 */ });
  }

  function load() {
    if (!st.target) return Promise.resolve();
    return api.annotation.load({ judgmentId: st.target.id, jurisdiction: st.target.jurisdiction, includeAi: st.includeAi })
      .then(function (r) {
        r.includeAi = st.includeAi;
        st.view = r;
        var labels = r.colorLabels || {};
        st.labels = labels;
        Array.prototype.forEach.call($('annToolbar').querySelectorAll('[data-color]'), function (b) {
          b.textContent = labels[b.getAttribute('data-color')] || b.textContent;
        });
        JR.views.renderAnnReader(r);
        JR.views.renderAnnNotes(r, pickNote);
        JR.views.renderAnnReanchor(r, reanchor, removeAnn);
        JR.views.renderAnnLabels(labels);
        renderEditor();
        $('annExport').disabled = false;
        $('annImportAi').disabled = false;
        $('annCount').textContent = r.annotations.filter(function (a) { return a.status === 'ok'; }).length + ' 則標注';
        return refreshJudgments();
      });
  }

  /** 顯示區塊並設定目標案件；不自動讀取全文（由「載入全文」或精讀完成時觸發）。 */
  function prepare(item) {
    if (!item) return;
    if (!st.target || st.target.id !== item.id) {
      st.view = null;
      st.editing = null;
      $('annReader').innerHTML = '';
      $('annNotes').innerHTML = '';
      renderEditor();
    }
    st.target = { id: item.id, title: item.title || item.id, jurisdiction: item.jurisdiction || '' };
    // 導覽列跟著目前案件：不在批次中的案件會隱藏導覽列。
    st.qIndex = -1;
    st.queue.forEach(function (q, i) { if (q.id === item.id) st.qIndex = i; });
    renderNav();
    $('annSection').hidden = false;
    $('annLoad').disabled = false;
    $('annExport').disabled = true;
    $('annImportAi').disabled = true;
    $('annCount').textContent = '';
    JR.setStatus($('annStatus'), '案件：' + st.target.title + '。按「載入全文」開始標注。', '');
  }

  /** 助理用：在目前載入的全文中標注一段原文（顏色：yellow、green、pink、blue；有註解則為螢光並做筆記）。 */
  function annotateQuote(quote, color, note) {
    if (!st.target || !st.view || !st.view.fullText) return { ok: false, reason: '請先在「單一判決精讀」載入判決全文，再標注。' };
    var idx = st.view.fullText.indexOf(quote);
    if (idx < 0) return { ok: false, reason: '全文中找不到這段文字，請改用全文中的原句。' };
    api.annotation.add({
      judgmentId: st.target.id, jurisdiction: st.target.jurisdiction,
      start: idx, end: idx + quote.length, color: color, mode: note ? 'highlight_note' : 'highlight', note: note || ''
    }).then(function (ann) {
      if (ann.mode === 'highlight_note') st.editing = ann.id;
      return load();
    }).catch(fail);
    return { ok: true };
  }

  JR.controllers.annotation = {
    annotateQuote: annotateQuote,
    /** 精讀完成或開啟已存的精讀結果時，直接載入全文與標注。 */
    open: function (judgmentId, jurisdiction, title) {
      prepare({ id: judgmentId, title: title || judgmentId, jurisdiction: jurisdiction || '' });
      clearStatus();
      load().then(function () { clearStatus(); }).catch(fail);
    },
    prepare: prepare,
    /** 設定逐案閱讀的案件批次；index 為目前案件（-1 表示不在批次中，隱藏導覽列）。 */
    setQueue: function (items, index, jurisdiction) {
      st.queue = (items || []).map(function (q) {
        return { id: q.id, title: q.title || q.id, jurisdiction: q.jurisdiction != null ? q.jurisdiction : (jurisdiction || '') };
      });
      st.qIndex = index;
      renderNav();
    },
    bind: function () {
      var rd = $('annReader');
      rd.addEventListener('mouseup', onMouseUp);
      rd.addEventListener('click', reader);
      var tb = $('annToolbar');
      // 點工具列時不清掉選取範圍。
      tb.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      document.addEventListener('mousedown', function (ev) {
        if (!tb.hidden && !tb.contains(ev.target)) hideToolbar();
      });
      Array.prototype.forEach.call(tb.querySelectorAll('[data-color]'), function (b) {
        b.addEventListener('click', function () { applyColor(b.getAttribute('data-color')); });
      });
      Array.prototype.forEach.call(tb.querySelectorAll('[data-mode]'), function (b) {
        b.addEventListener('click', function () { st.mode = b.getAttribute('data-mode'); setModeButtons(); });
      });
      $('annLoad').addEventListener('click', function () {
        load().then(clearStatus).catch(fail);
      });
      $('annShowAi').addEventListener('change', function () {
        st.includeAi = $('annShowAi').checked;
        load().catch(fail);
      });
      $('annPrev').addEventListener('click', function () { goQueue(-1); });
      $('annNext').addEventListener('click', function () { goQueue(1); });
      $('annExportMany').addEventListener('click', exportMany);
      $('annSyncNow').addEventListener('click', syncNow);
      syncRefresh();
      $('annLabelsSave').addEventListener('click', function () {
        saveLabels({
          yellow: $('annLabel-yellow').value,
          green: $('annLabel-green').value,
          pink: $('annLabel-pink').value,
          blue: $('annLabel-blue').value
        });
      });
      $('annLabelsReset').addEventListener('click', function () {
        saveLabels({ yellow: '事實', green: '爭點', pink: '主文', blue: '理由' });
      });
      $('annImportAi').addEventListener('click', function () {
        var brief = JR.state.brief;
        var quotes = [];
        if (brief && brief.detail && brief.detail.meta.id === st.target.id) {
          brief.doc.sections.forEach(function (sec) { (sec.evidence || []).forEach(function (q) { quotes.push(q); }); });
        }
        if (!quotes.length) {
          JR.setStatus($('annStatus'), '沒有可加入的 AI 引文（請先完成該案的精讀）。', 'error');
          return;
        }
        api.annotation.importAi({ judgmentId: st.target.id, jurisdiction: st.target.jurisdiction, quotes: quotes })
          .then(function (r) {
            return load().then(function () {
              JR.setStatus($('annStatus'), '已加入 ' + r.added + ' 則 AI 引文標注（略過 ' + r.skipped + ' 則）。', 'ok');
            });
          })
          .catch(fail);
      });
      $('annExport').addEventListener('click', function () {
        api.annotation.export({ judgmentId: st.target.id, jurisdiction: st.target.jurisdiction })
          .then(function (r) { if (!r.canceled) JR.setStatus($('annStatus'), '已匯出：' + r.filePath, 'ok'); })
          .catch(fail);
      });
    }
  };
})(window.JR);
