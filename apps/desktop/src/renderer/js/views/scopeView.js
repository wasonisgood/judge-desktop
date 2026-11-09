// 視圖：標編碼標注工序（每部法規或關鍵字一個區塊；綜合分析、覆核工具列與逐案表格）。
// 覆核：待覆核的格子標示底色；每案可展開覆核面板，逐欄檢視內容與依據，接受、修改、駁回、還原。
// 視圖不保存狀態：所有操作與狀態由控制器傳入（ui），操作後由控制器重新繪製。
(function (JR) {
  'use strict';

  /** 沒有設定時使用的預設分析欄位（與核心的 DEFAULT_CODING_FIELDS 順序一致）。 */
  var DEFAULT_FIELDS = [
    { id: 'group', name: '分類' },
    { id: 'issue', name: '爭點' },
    { id: 'holding', name: '法院見解' },
    { id: 'statuteApplication', name: '法條適用' },
    { id: 'outcome', name: '結論' }
  ];

  /** 篩選選項：只看含有該狀態格子的案件。 */
  var FILTERS = [
    { value: 'all', label: '全部' },
    { value: 'pending', label: '待覆核' },
    { value: 'accepted', label: '已接受' },
    { value: 'rejected', label: '已駁回' }
  ];

  JR.views.renderScopeFields = function (list) {
    var box = JR.$('scopeFieldList');
    box.innerHTML = '';
    var rows = list && list.length ? list : DEFAULT_FIELDS;
    rows.forEach(function (f) { box.appendChild(JR.components.codingFieldRow(f)); });
  };

  function valueOf(a, fieldId) {
    return a && a.values ? a.values.filter(function (x) { return x.fieldId === fieldId; })[0] : null;
  }

  /** 覆核狀態的文字（無須覆核的結果不顯示）。 */
  function statusText(v) {
    if (v.reviewStatus === 'pending') return '待覆核';
    if (v.reviewStatus === 'rejected') return '已駁回';
    if (v.reviewStatus === 'accepted') return v.aiValue !== undefined && v.aiValue !== v.value ? '已修改' : '已接受';
    return '';
  }

  /** 逐案表的一格：內容；待覆核的格子加上標記，依據放在提示文字中。 */
  function codedCell(a, f) {
    var v = valueOf(a, f.id);
    if (!v) return { text: a ? (a[f.id] || '') : '', pending: false, title: '' };
    var title = v.evidence && v.evidence.length ? '依據：' + v.evidence.join('\n') : '';
    if (v.reviewStatus === 'pending' && v.reviewNote) title = (title ? title + '\n' : '') + '待覆核：' + v.reviewNote;
    return { text: v.value || '（未取得）', pending: v.reviewStatus === 'pending', title: title, status: statusText(v) };
  }

  /** 篩選：案件是否含有指定狀態的格子（沒有欄位資料的舊結果只在「全部」中顯示）。 */
  function caseMatches(a, filter) {
    if (!filter || filter === 'all') return true;
    var want = { pending: 'pending', accepted: 'accepted', rejected: 'rejected' }[filter];
    return !!(a && a.values && a.values.some(function (v) { return v.reviewStatus === want; }));
  }

  function cellKey(si, caseId, fieldId) { return si + '|' + caseId + '|' + fieldId; }

  /** 覆核面板：每個欄位一塊，內容、依據（可展開，可逐則跳至原文）與操作。 */
  function reviewPanel(ui, si, r, a, fields, colCount) {
    var el = JR.el;
    var tr = el('tr', 'review-row');
    var td = el('td');
    td.colSpan = colCount;
    var box = el('div', 'review-panel');
    box.appendChild(el('p', 'hint', '逐欄覆核：接受、修改或駁回後，可用「還原此欄」或工具列的「還原上一步」撤銷。依據是判決原文的逐字引用，「跳至原文」在應用程式內開啟判決原文，並標示依據所在位置。'));
    fields.forEach(function (f) {
      var v = valueOf(a, f.id);
      var key = cellKey(si, r.id, f.id);
      var item = el('div', 'review-field' + (v && v.reviewStatus === 'pending' ? ' pending-cell' : ''));
      var head = el('div', 'review-field-head');
      head.appendChild(el('strong', '', f.name));
      if (v && statusText(v)) head.appendChild(el('em', 'review-status review-status-' + v.reviewStatus, statusText(v)));
      if (v && v.reviewStatus === 'pending' && v.reviewNote) head.appendChild(el('span', 'hint', v.reviewNote));
      item.appendChild(head);

      if (ui.editing === key) {
        var ta = el('textarea', 'review-edit');
        ta.rows = 3;
        ta.value = v ? v.value : '';
        item.appendChild(ta);
        var save = el('button', 'btn small primary', '儲存修改');
        save.type = 'button';
        save.addEventListener('click', function () { ui.actions.edit({ sheetIndex: si, caseId: r.id, fieldId: f.id }, ta.value); });
        var cancel = el('button', 'btn small', '取消');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { ui.actions.cancelEdit(); });
        var editRow = el('div', 'review-actions');
        editRow.appendChild(save);
        editRow.appendChild(cancel);
        item.appendChild(editRow);
      } else {
        item.appendChild(el('p', 'review-value', v ? (v.value || '（未取得）') : (a ? (a[f.id] || '') : '')));
        if (v && v.aiValue !== undefined && v.aiValue !== v.value) item.appendChild(el('p', 'hint', 'AI 原文：' + v.aiValue));
      }

      if (v) {
        var ev = el('details', 'review-evidence');
        ev.appendChild(el('summary', '', v.evidence.length ? '依據（' + v.evidence.length + ' 則）' : '沒有有效依據'));
        var list = el('ul');
        v.evidence.forEach(function (q) {
          var li = el('li', '', q);
          var go = el('button', 'btn small', '跳至原文');
          go.type = 'button';
          go.addEventListener('click', function () { ui.actions.openSource(r.id, q); });
          li.appendChild(document.createTextNode(' '));
          li.appendChild(go);
          list.appendChild(li);
        });
        if (v.droppedEvidence) list.appendChild(el('li', 'hint', '已移除 ' + v.droppedEvidence + ' 則不在判決原文中的依據'));
        ev.appendChild(list);
        item.appendChild(ev);

        if (ui.editing !== key) {
          var acts = el('div', 'review-actions');
          acts.appendChild(button('接受', function () { ui.actions.accept({ sheetIndex: si, caseId: r.id, fieldId: f.id }); }));
          acts.appendChild(button('修改', function () { ui.actions.startEdit(key); }));
          acts.appendChild(button('駁回', function () { ui.actions.reject({ sheetIndex: si, caseId: r.id, fieldId: f.id }); }));
          if (v.reviewHistory && v.reviewHistory.length) {
            acts.appendChild(button('還原此欄', function () { ui.actions.undo([{ sheetIndex: si, caseId: r.id, fieldId: f.id }]); }));
          }
          item.appendChild(acts);
        }
      }
      box.appendChild(item);
    });
    td.appendChild(box);
    tr.appendChild(td);
    return tr;
  }

  function button(label, onClick) {
    var b = JR.el('button', 'btn small', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * 繪製結果。ui（可選）：summaries（每表的覆核摘要）、openPanels、editing、filters、canUndo、actions（操作回呼）。
   * 沒有 ui 時只顯示結果（與舊版相同）。
   */
  JR.views.renderScope = function (sheets, ui) {
    var el = JR.el;
    ui = ui || {};
    ui.openPanels = ui.openPanels || {};
    ui.filters = ui.filters || {};
    var box = JR.$('scopeResult');
    box.innerHTML = '';
    var summaries = ui.summaries || [];
    var totalPending = summaries.reduce(function (n, s) { return n + (s ? s.pending : 0); }, 0);
    if (totalPending) box.appendChild(el('p', 'pending-summary', '待覆核共 ' + totalPending + ' 格（待覆核的格子以底色標示；按「覆核」展開逐欄檢視）。'));
    sheets.forEach(function (sh, si) {
      var block = el('div', 'scope-block');
      var title = el('h2', '', sh.statute + '（' + sh.rows.length + ' 筆）');
      var sum = summaries[si];
      if (sum && sum.pending) title.appendChild(el('em', 'pending-tag', '待覆核 ' + sum.pending + ' 格'));
      block.appendChild(title);
      if (sh.rows.length === 0) {
        block.appendChild(el('p', 'hint', '沒有找到符合條件的判決。'));
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
      if (sh.caseType) {
        block.appendChild(el('p', 'hint', '案件類型：' + sh.caseType.type + '（依判決字號篩選，排除 ' + sh.caseType.excluded + ' 筆；「重疊」「未知」的字號不會被納入）'));
      }
      var fields = sh.fields && sh.fields.length ? sh.fields : DEFAULT_FIELDS;
      var byId = {};
      (sh.analyses || []).forEach(function (a) { byId[a.id] = a; });
      var hasValues = (sh.analyses || []).some(function (a) { return a.values && a.values.length; });

      if (ui.actions && hasValues) {
        var bar = el('div', 'review-toolbar');
        var sel = el('select', 'review-filter');
        sel.setAttribute('aria-label', '篩選覆核狀態');
        var current = ui.filters[si] || 'all';
        FILTERS.forEach(function (o) {
          var opt = el('option', '', o.label);
          opt.value = o.value;
          if (o.value === current) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', function () { ui.actions.setFilter(si, sel.value); });
        bar.appendChild(el('span', 'hint', '只看：'));
        bar.appendChild(sel);
        var batchN = sum ? sum.highConfidence : 0;
        var batch = button('批次接受高信心結果（' + batchN + '）', function () { ui.actions.batch(si); });
        batch.disabled = batchN === 0;
        batch.title = '高信心：系統判定可接受、內容非空、依據達門檻，且尚未覆核的格子。可用「還原上一步」撤銷。';
        bar.appendChild(batch);
        var undo = button('還原上一步', function () { ui.actions.undoLast(); });
        undo.disabled = !ui.canUndo;
        bar.appendChild(undo);
        block.appendChild(bar);
      }

      var wrap = el('div', 'table-wrap');
      var table = el('table', 'table');
      var heads = ['序號', '裁判字號', '裁判日期'].concat(fields.map(function (f) { return f.name; }), ['引用條文', '法條異動', '歷審位置', '字號類型', '操作']);
      var thead = el('thead');
      var headRow = el('tr');
      heads.forEach(function (h) { headRow.appendChild(el('th', '', h)); });
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = el('tbody');
      var colCount = heads.length;
      sh.rows.forEach(function (r, i) {
        var a = byId[r.id];
        if (!caseMatches(a, ui.filters[si] || 'all')) return;
        var notes = (r.lawNotes || []).map(function (n) { return n.summary; }).join('\n');
        var tr = el('tr');
        tr.appendChild(el('td', 'num', String(i + 1)));
        tr.appendChild(el('td', '', r.title));
        tr.appendChild(el('td', '', r.dateIso || ''));
        fields.forEach(function (f) {
          var c = codedCell(a, f);
          var td = el('td', c.pending ? 'pending-cell' : '');
          td.appendChild(document.createTextNode(c.text));
          if (c.pending) td.appendChild(el('em', 'pending-tag', '待覆核'));
          if (c.title) td.title = c.title;
          tr.appendChild(td);
        });
        tr.appendChild(el('td', '', r.citedArticles.join('；')));
        tr.appendChild(el('td', '', notes));
        tr.appendChild(el('td', '', r.historyPosition || ''));
        tr.appendChild(el('td', '', r.caseTypeLabel || ''));
        var bt = el('td');
        if (ui.actions && a && a.values && a.values.length) {
          var key = cellKey(si, r.id, '');
          var open = !!ui.openPanels[key];
          bt.appendChild(button(open ? '收起覆核' : '覆核', function () { ui.actions.togglePanel(key); }));
        }
        bt.appendChild(button('精讀這則', function () { JR.controllers.brief.openFromList(r, sh.rows); }));
        tr.appendChild(bt);
        tbody.appendChild(tr);
        if (ui.actions && a && a.values && a.values.length && ui.openPanels[cellKey(si, r.id, '')]) {
          tbody.appendChild(reviewPanel(ui, si, r, a, fields, colCount));
        }
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      block.appendChild(wrap);
      box.appendChild(block);
    });
  };
})(window.JR);
