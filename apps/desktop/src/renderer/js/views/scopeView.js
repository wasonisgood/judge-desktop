// 視圖：範圍整理表（每部法規一個區塊；綜合分析＋逐案表格）。
(function (JR) {
  'use strict';

  JR.views.renderScope = function (sheets) {
    var el = JR.el;
    var box = JR.$('scopeResult');
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
      table.innerHTML = '<thead><tr><th>序號</th><th>裁判字號</th><th>裁判日期</th><th>類型</th><th>爭點</th><th>法院見解</th><th>結論</th><th>引用條文</th><th>法條異動</th><th>歷審位置</th><th>操作</th></tr></thead>';
      var tbody = el('tbody');
      var byId = {};
      (sh.analyses || []).forEach(function (a) { byId[a.id] = a; });
      sh.rows.forEach(function (r, i) {
        var a = byId[r.id] || {};
        var notes = (r.lawNotes || []).map(function (n) { return n.summary; }).join('\n');
        var tr = el('tr');
        [String(i + 1), r.title, r.dateIso || '', a.group || '', a.issue || '', a.holding || '', a.outcome || '', r.citedArticles.join('；'), notes, r.historyPosition || ''].forEach(function (text, j) {
          tr.appendChild(el('td', j === 0 ? 'num' : '', text));
        });
        var bt = el('td');
        var b = el('button', 'btn small', '精讀這則');
        b.type = 'button';
        b.addEventListener('click', function () { JR.controllers.brief.openFromList(r); });
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
