// 視圖：判決列表。AI 篩選：相關的排前面並附理由，不相關的預設隱藏，可勾選查看。
(function (JR) {
  'use strict';

  JR.views.renderList = function (items) {
    var $ = JR.$, state = JR.state;
    var body = $('listBody');
    body.innerHTML = '';
    var verdicts = state.listVerdicts;
    var rows = items.map(function (it, i) { return { it: it, i: i }; });
    var hiddenCount = 0;
    if (verdicts) {
      rows.sort(function (a, b) {
        var va = verdicts[a.it.id] || { relevant: false }, vb = verdicts[b.it.id] || { relevant: false };
        return (vb.relevant ? 1 : 0) - (va.relevant ? 1 : 0) || a.i - b.i;
      });
      hiddenCount = rows.filter(function (x) { return !((verdicts[x.it.id] || {}).relevant); }).length;
      if (!$('listShowAll').checked) rows = rows.filter(function (x) { return (verdicts[x.it.id] || {}).relevant; });
      $('listScreenStatus').textContent = '相關 ' + (items.length - hiddenCount) + ' 筆，不相關 ' + hiddenCount + ' 筆' + (hiddenCount && !$('listShowAll').checked ? '（已隱藏）' : '');
    } else {
      $('listScreenStatus').textContent = '';
    }
    $('listShowAllWrap').hidden = !verdicts;
    rows.forEach(function (x, n) {
      var it = x.it;
      var tr = document.createElement('tr');
      [String(n + 1), it.title, it.dateIso || it.dateDisplay || '', it.cause || ''].forEach(function (text, j) {
        var td = document.createElement('td');
        if (j === 0) td.className = 'num';
        if (j === 2) td.className = 'nowrap';
        td.textContent = text;
        tr.appendChild(td);
      });
      var v = verdicts && verdicts[it.id];
      var judge = document.createElement('td');
      judge.textContent = v ? ((v.relevant ? '相關：' : '不相關：') + v.reason) : '';
      tr.appendChild(judge);
      var bt = document.createElement('td');
      var b = document.createElement('button');
      b.className = 'btn small'; b.type = 'button'; b.textContent = '精讀這則';
      b.addEventListener('click', function () { JR.controllers.brief.openFromList(it); });
      bt.appendChild(b);
      tr.appendChild(bt);
      body.appendChild(tr);
    });
    $('listResult').hidden = items.length === 0;
  };
})(window.JR);
