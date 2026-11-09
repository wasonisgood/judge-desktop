// 視圖：標編碼標注工序（每部法規或關鍵字一個區塊；綜合分析＋逐案表格）。欄位依該區塊的分析欄位設定產生。
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

  JR.views.renderScopeFields = function (list) {
    var box = JR.$('scopeFieldList');
    box.innerHTML = '';
    var rows = list && list.length ? list : DEFAULT_FIELDS;
    rows.forEach(function (f) { box.appendChild(JR.components.codingFieldRow(f)); });
  };

  /** 逐案表的一格：內容；待覆核的格子加上標記，依據放在提示文字中。 */
  function codedCell(a, f) {
    var v = a && a.values ? a.values.filter(function (x) { return x.fieldId === f.id; })[0] : null;
    if (!v) return { text: a ? (a[f.id] || '') : '', pending: false, title: '' };
    var title = v.evidence && v.evidence.length ? '依據：' + v.evidence.join('\n') : '';
    if (v.reviewStatus === 'pending' && v.reviewNote) title = (title ? title + '\n' : '') + '待覆核：' + v.reviewNote;
    return { text: v.value || '（未取得）', pending: v.reviewStatus === 'pending', title: title };
  }

  JR.views.renderScope = function (sheets) {
    var el = JR.el;
    var box = JR.$('scopeResult');
    box.innerHTML = '';
    sheets.forEach(function (sh) {
      var block = el('div', 'scope-block');
      block.appendChild(el('h2', '', sh.statute + '（' + sh.rows.length + ' 筆）'));
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
      var wrap = el('div', 'table-wrap');
      var table = el('table', 'table');
      var heads = ['序號', '裁判字號', '裁判日期'].concat(fields.map(function (f) { return f.name; }), ['引用條文', '法條異動', '歷審位置', '字號類型', '操作']);
      var thead = el('thead');
      var headRow = el('tr');
      heads.forEach(function (h) { headRow.appendChild(el('th', '', h)); });
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = el('tbody');
      var byId = {};
      (sh.analyses || []).forEach(function (a) { byId[a.id] = a; });
      sh.rows.forEach(function (r, i) {
        var a = byId[r.id];
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
        var b = el('button', 'btn small', '精讀這則');
        b.type = 'button';
        b.addEventListener('click', function () { JR.controllers.brief.openFromList(r, sh.rows); });
        bt.appendChild(b);
        tr.appendChild(bt);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      block.appendChild(wrap);
      box.appendChild(block);
    });
  };
})(window.JR);
