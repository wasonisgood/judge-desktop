// 視圖：納入／排除核查的結果（每案一列、每條標準一欄，依據可展開）、次數選單、比較結果與重新檢索提示。
(function (JR) {
  'use strict';

  var DECISION = { include: '納入', exclude: '排除', review: '需人工檢視' };
  var VERDICT = { met: '符合', not_met: '不符合', unknown: '無法判斷' };

  function runLabel(r) {
    var s = r.summary;
    return '第 ' + r.runNo + ' 次｜' + r.query + '｜' + JR.fmtTime(r.createdAt) + '｜納入 ' + s.include + '、排除 ' + s.exclude + '、需檢視 ' + s.review;
  }

  /** 次數選單：兩個下拉（查看、比較）共用同一份紀錄，最新的排在最前。 */
  JR.views.renderRunOptions = function (runs, selectedNo, compareNo) {
    var $ = JR.$;
    var list = (runs || []).slice().sort(function (a, b) { return b.runNo - a.runNo; });
    [['critRunSel', selectedNo], ['critCompareSel', compareNo]].forEach(function (pair) {
      var sel = $(pair[0]);
      sel.innerHTML = '';
      if (!list.length) {
        var none = document.createElement('option');
        none.value = '';
        none.textContent = '（尚無核查紀錄）';
        sel.appendChild(none);
        return;
      }
      list.forEach(function (r) {
        var o = document.createElement('option');
        o.value = String(r.runNo);
        o.textContent = runLabel(r);
        sel.appendChild(o);
      });
      if (pair[1]) sel.value = String(pair[1]);
    });
    $('critCompare').disabled = list.length < 2;
    $('critExport').disabled = !list.length;
  };

  /** 結果表：標頭依該次核查的標準；每格顯示判定，點開可看依據與逐字原文。 */
  JR.views.renderRun = function (run) {
    var $ = JR.$, el = JR.el;
    var head = $('critHead');
    var body = $('critBody');
    head.innerHTML = '';
    body.innerHTML = '';
    var hr = document.createElement('tr');
    ['序號', '案號', '日期', '決定'].concat(run.criteria.map(function (c) {
      return (c.kind === 'include' ? '納入' : '排除') + '：' + c.text + '（' + (c.method === 'program' ? '程式' : 'AI') + '）';
    })).forEach(function (t) {
      var th = document.createElement('th');
      th.textContent = t;
      hr.appendChild(th);
    });
    head.appendChild(hr);

    run.outcomes.forEach(function (o, i) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'num', String(i + 1)));
      tr.appendChild(el('td', 'crit-caseno', o.caseNo || o.id));
      tr.appendChild(el('td', 'nowrap', o.dateIso || ''));
      tr.appendChild(el('td', 'crit-decision crit-d-' + o.decision, DECISION[o.decision] || o.decision));
      run.criteria.forEach(function (c) {
        var td = document.createElement('td');
        var r = o.results.filter(function (x) { return x.criterionId === c.id; })[0];
        if (!r) { td.textContent = '未判斷'; tr.appendChild(td); return; }
        var det = document.createElement('details');
        det.className = 'crit-cell';
        var sum = el('summary', 'crit-verdict crit-v-' + r.verdict,
          VERDICT[r.verdict] + (r.invalidEvidence ? '（依據無效，已改為無法判斷）' : ''));
        det.appendChild(sum);
        det.appendChild(el('div', 'crit-basis', r.basis));
        (r.quotes || []).forEach(function (q) { det.appendChild(el('blockquote', 'crit-quote', q)); });
        td.appendChild(det);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $('critResult').hidden = run.outcomes.length === 0;
    JR.setStatus($('critResultStatus'), '第 ' + run.runNo + ' 次：候選 ' + run.summary.total + ' 筆，納入 ' + run.summary.include + '、排除 ' + run.summary.exclude + '、需人工檢視 ' + run.summary.review + '。' + (run.summary.invalidEvidenceCount ? '無效依據 ' + run.summary.invalidEvidenceCount + ' 則（已標示）。' : ''));
  };

  JR.views.clearRun = function () {
    JR.$('critHead').innerHTML = '';
    JR.$('critBody').innerHTML = '';
    JR.$('critResult').hidden = true;
    JR.setStatus(JR.$('critResultStatus'), '');
  };

  /** 重新檢索建議：只是提示，不會自動改動查詢。 */
  JR.views.renderSuggestion = function (suggestion) {
    var box = JR.$('critSuggest');
    if (!suggestion || !suggestion.suggest) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = '建議重新檢索：' + suggestion.reasons.join('；') + '。可展開「以新關鍵字重新檢索」另擬關鍵字，新的結果會另外保存。';
    JR.$('critRerun').open = true;
  };

  /** 兩次核查的比較：決定不同的案件（從 → 到）與只出現在其中一次的案件數。 */
  JR.views.renderCompare = function (cmp, a, b) {
    var box = JR.$('critCompareBox');
    box.innerHTML = '';
    box.hidden = false;
    box.appendChild(JR.el('p', 'hint', '第 ' + a.runNo + ' 次 與 第 ' + b.runNo + ' 次：決定不同的案件 ' + cmp.changed.length + ' 筆；只在第 ' + a.runNo + ' 次的 ' + cmp.onlyInA.length + ' 筆；只在第 ' + b.runNo + ' 次的 ' + cmp.onlyInB.length + ' 筆。'));
    if (!cmp.changed.length) return;
    var ul = document.createElement('ul');
    ul.className = 'crit-changes';
    cmp.changed.forEach(function (c) {
      var li = document.createElement('li');
      li.textContent = (c.caseNo || c.id) + '：' + DECISION[c.from] + ' → ' + DECISION[c.to];
      ul.appendChild(li);
    });
    box.appendChild(ul);
  };
})(window.JR);
