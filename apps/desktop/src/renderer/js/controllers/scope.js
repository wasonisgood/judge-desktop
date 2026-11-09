// 控制器：範圍整理表（執行、進度、匯出）。結果交給助理作為上下文（助理看不到畫面）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;

  function statuteLines() {
    return $('scopeLines').value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  async function exportScope(format) {
    if (!state.scopeSheets) return;
    try {
      var r = await api.scope.export({ sheets: state.scopeSheets, yearFrom: state.scopeFrom, yearTo: state.scopeTo, format: format });
      if (!r.canceled) JR.setStatus($('scopeStatus'), '已匯出：' + r.filePath, 'ok');
    } catch (err) {
      JR.setStatus($('scopeStatus'), '匯出失敗：' + JR.errText(err), 'error');
    }
  }

  JR.controllers.scope = {
    /** 供助理與「檔案」頁面重新開啟結果。 */
    showResult: function (sheets, from, to) {
      state.scopeSheets = sheets;
      state.scopeFrom = from;
      state.scopeTo = to;
      JR.views.renderScope(sheets);
      $('scopeXlsx').disabled = false;
      $('scopeDocx').disabled = false;
    },
    bind: function () {
      $('scopeForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var statutes = statuteLines();
        if (statutes.length === 0) {
          JR.setStatus($('scopeStatus'), '請至少輸入一部法規。', 'error');
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
        state.scopeRunning = true;
        JR.setStatus($('scopeStatus'), '確認法名中…（每則判決都會交由 AI 分析）');
        try {
          var r = await api.scope.run({ statutes: statutes, yearFrom: from, yearTo: to, maxItems: max });
          JR.controllers.scope.showResult(r.sheets, from, to);
          var total = r.sheets.reduce(function (n, s) { return n + s.rows.length; }, 0);
          // 把結果摘要交給助理，讓它能接著討論（助理只看得到對話紀錄，看不到畫面）。
          state.assistHistory.push({ role: 'user', text: '[系統通知] 範圍整理已完成。' + r.sheets.map(function (sh) {
            return sh.statute + '共 ' + sh.rows.length + ' 筆：' + sh.rows.slice(0, 10).map(function (x, i) {
              var a = (sh.analyses || []).filter(function (y) { return y.id === x.id; })[0] || {};
              return (i + 1) + '. ' + x.title + '（' + (x.dateIso || '') + '）爭點：' + (a.issue || '') + '；引用：' + x.citedArticles.join('、');
            }).join(' ');
          }).join(' ') });
          var noteText = (r.notes && r.notes.length) ? ' ' + r.notes.join(' ') : '';
          JR.setStatus($('scopeStatus'), '完成，共 ' + total + ' 筆，已存入「檔案」。' + noteText, 'ok');
        } catch (err) {
          JR.setStatus($('scopeStatus'), '整理失敗：' + JR.errText(err), 'error');
        } finally {
          state.scopeRunning = false;
          $('scopeRun').disabled = false;
          $('scopeProgress').hidden = true;
        }
      });
      api.scope.onProgress(function (p) {
        // 進度訊息與執行結果走不同通道，可能晚到；只在執行中才更新，避免蓋掉「完成」的狀態。
        if (!state.scopeRunning) return;
        $('scopeProgress').querySelector('.bar').style.width = Math.round((p.done / Math.max(p.total, 1)) * 100) + '%';
        JR.setStatus($('scopeStatus'), '「' + p.statute + '」' + p.phase + '：' + p.done + ' / ' + p.total);
      });
      $('scopeXlsx').addEventListener('click', function () { exportScope('xlsx'); });
      $('scopeDocx').addEventListener('click', function () { exportScope('docx'); });
    }
  };
})(window.JR);
