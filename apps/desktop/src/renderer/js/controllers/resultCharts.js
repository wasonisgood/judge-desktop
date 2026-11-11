// 控制器：結果自動出圖。把目前的結果列交給主程序（chart:forResult），把回傳的 SVG 放進指定區塊。
// 模組未啟用時只顯示提示；每次更新都以序號丟棄過期的回應，避免舊結果蓋過新結果。
(function (JR) {
  'use strict';
  var api = window.api;
  var seq = {};

  // 把結果圖表放進區塊：ok 為產生圖表的呼叫（回傳 { enabled, charts, warnings }）。
  function paint(targetId, n, fetch, emptyHidden) {
    var box = document.getElementById(targetId);
    if (!box) return;
    if (emptyHidden) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = '圖表產生中…';
    fetch().then(function (r) {
      if (seq[targetId] !== n) return;
      box.textContent = '';
      if (!r.enabled) {
        box.appendChild(JR.el('p', 'hint', '量化圖表模組尚未啟用。到「設定」→「模組」開啟後，結果會自動出圖。'));
        return;
      }
      box.appendChild(JR.el('h3', 'result-charts-title', '依本次結果自動產生的圖表'));
      r.charts.forEach(function (c) {
        var fig = JR.el('figure', 'result-chart');
        fig.innerHTML = c.svg; // 由主程序產生，文字已跳脫（見 chartData 的 escapeXml）。
        box.appendChild(fig);
      });
      (r.warnings || []).forEach(function (w) { box.appendChild(JR.el('p', 'hint', w)); });
    }).catch(function (err) {
      if (seq[targetId] !== n) return;
      box.textContent = '圖表產生失敗：' + JR.errText(err);
    });
  }

  JR.controllers.resultCharts = {
    /** 納入排除的執行紀錄：每案決定與每條標準的判定分布。 */
    showRun: function (targetId, run) {
      var n = (seq[targetId] || 0) + 1;
      seq[targetId] = n;
      var outcomes = (run && run.outcomes || []).map(function (o) {
        return {
          id: o.caseNo || o.id,
          decision: o.decision,
          dateIso: o.dateIso || null,
          verdicts: (o.results || []).map(function (res) {
            var c = (run.criteria || []).filter(function (x) { return x.id === res.criterionId; })[0];
            return { name: c ? (c.text || (c.keywords || []).join('、') || '標準') : '標準', verdict: res.verdict };
          })
        };
      });
      paint(targetId, n, function () { return api.chart.forRun({ outcomes: outcomes }); }, outcomes.length === 0);
    },
    show: function (targetId, rows) {
      var box = document.getElementById(targetId);
      if (!box) return;
      var n = (seq[targetId] || 0) + 1;
      seq[targetId] = n;
      if (!rows || rows.length === 0) {
        box.hidden = true;
        box.textContent = '';
        return;
      }
      box.hidden = false;
      box.textContent = '圖表產生中…';
      api.chart.forResult({ rows: rows }).then(function (r) {
        if (seq[targetId] !== n) return;
        box.textContent = '';
        if (!r.enabled) {
          box.appendChild(JR.el('p', 'hint', '量化圖表模組尚未啟用。到「設定」→「模組」開啟後，結果會自動出圖。'));
          return;
        }
        box.appendChild(JR.el('h3', 'result-charts-title', '依本次結果自動產生的圖表'));
        r.charts.forEach(function (c) {
          var fig = JR.el('figure', 'result-chart');
          fig.innerHTML = c.svg; // 由主程序產生，文字已跳脫（見 chartData 的 escapeXml）。
          box.appendChild(fig);
        });
        (r.warnings || []).forEach(function (w) { box.appendChild(JR.el('p', 'hint', w)); });
      }).catch(function (err) {
        if (seq[targetId] !== n) return;
        box.textContent = '圖表產生失敗：' + JR.errText(err);
      });
    }
  };
})(window.JR);
