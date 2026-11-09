// 控制器：範圍整理表（執行、可取消、進度、匯出）。結果交給助理作為上下文（助理看不到畫面）。
// v3.6.0：單頁同時只一項工作；取消保留已完成部分；存檔失敗明確提示；法名選項可取消。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;
  var PAGE = 'scope';

  function statuteLines() {
    return $('scopeLines').value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // 法名有多個候選時，使用者選定後替換該行並重新執行（issue #4 第 3 點）。
  function replaceStatuteLine(oldLine, newLine) {
    var lines = $('scopeLines').value.split(/\n/).map(function (x) { return x.trim(); });
    var idx = lines.indexOf(String(oldLine || '').trim());
    if (idx < 0) lines.push(newLine); else lines[idx] = newLine;
    $('scopeLines').value = lines.filter(Boolean).join('\n');
    $('scopeForm').dispatchEvent(new Event('submit', { cancelable: true }));
  }

  function setRunning(on) {
    $('scopeRun').disabled = on;
    $('scopeXlsx').disabled = on;
    $('scopeDocx').disabled = on;
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
        if (JR.jobs.isBusy(PAGE)) {
          JR.setStatus($('scopeStatus'), '範圍整理已有工作進行中，請等候完成或按「取消」。', 'error');
          return;
        }
        var statutes = statuteLines();
        if (statutes.length === 0) {
          JR.setStatus($('scopeStatus'), '請至少輸入一部法規。', 'error');
          return;
        }
        var from = Number($('scopeFrom').value) || undefined;
        var to = Number($('scopeTo').value) || undefined;
        var max = Number($('scopeMax').value) || 30;
        setRunning(true);
        $('scopeResult').innerHTML = '';
        $('scopeProgress').hidden = false;
        state.scopeRunning = true;
        var runId = JR.jobs.start(PAGE, 'scopeCancel');
        JR.setStatus($('scopeStatus'), $('scopeAiOn').checked ? '確認法名中…（每則判決都會交由 AI 分析）' : '確認法名中…（傳統篩選，不做 AI 分析）');
        try {
          JR.components.clarifyHide($('scopeClarify'));
          var r = await api.scope.run({
            runId: runId, statutes: statutes, yearFrom: from, yearTo: to, maxItems: max,
            jurisdiction: $('scopeJurisdiction').value, ai: $('scopeAi').value, aiAnalysis: $('scopeAiOn').checked,
            caseType: $('scopeCaseType').value
          });
          state.scopeExplanation = r.explanation;
          $('scopeExplain').disabled = !r.explanation;
          if (r.status === 'ask') {
            JR.components.clarifyBox($('scopeClarify'), {
              question: r.question,
              options: r.options,
              onPick: function (o) { replaceStatuteLine(r.statuteLine, o.label); },
              onManual: function (text) { replaceStatuteLine(r.statuteLine, text); },
              onCancel: function () { JR.setStatus($('scopeStatus'), '已取消法名選擇，沒有執行整理。'); }
            });
            JR.setStatus($('scopeStatus'), r.question);
            return;
          }
          JR.controllers.scope.showResult(r.sheets, from, to);
          var total = r.sheets.reduce(function (n, s) { return n + s.rows.length; }, 0);
          // 把結果摘要交給助理，讓它能接著討論（助理只看得到對話紀錄，看不到畫面）。
          state.assistHistory.push({ role: 'user', text: '[系統通知] 範圍整理已完成。' + r.sheets.map(function (sh) {
            return sh.statute + '共 ' + sh.rows.length + ' 筆：' + sh.rows.slice(0, 10).map(function (x, i) {
              var a = (sh.analyses || []).filter(function (y) { return y.id === x.id; })[0] || {};
              return (i + 1) + '. ' + x.title + '（' + (x.dateIso || '') + '）爭點：' + (a.issue || '') + '；引用：' + x.citedArticles.join('、');
            }).join(' ');
          }).join(' ') });
          var parts = [];
          parts.push(r.cancelled ? '已取消，保留已完成的 ' + total + ' 筆。' : '完成，共 ' + total + ' 筆。');
          if (r.saveError) parts.push(r.saveError);
          else if (!r.cancelled) parts.push('已存入「檔案」。');
          if ((r.notes || []).length) parts.push('注意：' + r.notes.join('；'));
          JR.setStatus($('scopeStatus'), parts.join('　'), (r.cancelled || r.saveError) ? 'error' : 'ok');
        } catch (err) {
          JR.setStatus($('scopeStatus'), '整理失敗：' + JR.errText(err), 'error');
        } finally {
          JR.jobs.finish(PAGE);
          state.scopeRunning = false;
          setRunning(false);
          $('scopeProgress').hidden = true;
        }
      });
      api.scope.onProgress(function (p) {
        // 進度訊息與執行結果走不同通道，可能晚到；只在執行中才更新，避免蓋掉「完成」的狀態。
        if (!state.scopeRunning) return;
        $('scopeProgress').querySelector('.bar').style.width = Math.round((p.done / Math.max(p.total, 1)) * 100) + '%';
        JR.setStatus($('scopeStatus'), '「' + p.statute + '」' + p.phase + '：' + p.done + ' / ' + p.total);
      });
      $('scopeExplain').addEventListener('click', function () {
        if (state.scopeExplanation) JR.components.explainDialog(state.scopeExplanation);
      });
      $('scopeXlsx').addEventListener('click', function () { exportScope('xlsx'); });
      $('scopeDocx').addEventListener('click', function () { exportScope('docx'); });
    }
  };
})(window.JR);
