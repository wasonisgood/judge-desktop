// 控制器：標編碼標注工序（範圍整理表；執行、可取消、進度、匯出）。結果交給助理作為上下文（助理看不到畫面）。
// v3.6.0：單頁同時只一項工作；取消保留已完成部分；存檔失敗明確提示；法名選項可取消。
// v3.8：關鍵字入口（自然語言、智慧搜尋、相關法規）與分析欄位設定（預設集、自訂、排序）保存在設定中。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;
  var PAGE = 'scope';

  function statuteLines() {
    return $('scopeLines').value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function collectScopeFields() {
    var out = [];
    document.querySelectorAll('#scopeFieldList .coding-field-row').forEach(function (row) {
      out.push({
        id: row.dataset.fieldId || '',
        name: row.querySelector('.brief-field-name').value.trim(),
        description: row.querySelector('.brief-field-desc').value.trim(),
        enabled: row.querySelector('.brief-field-on').checked
      });
    });
    return out;
  }

  // 法名有多個候選時，使用者選定後替換該行並重新執行（issue #4 第 3 點）。
  function replaceStatuteLine(oldLine, newLine) {
    var lines = $('scopeLines').value.split(/\n/).map(function (x) { return x.trim(); });
    var idx = lines.indexOf(String(oldLine || '').trim());
    if (idx < 0) lines.push(newLine); else lines[idx] = newLine;
    $('scopeLines').value = lines.filter(Boolean).join('\n');
    $('scopeForm').dispatchEvent(new Event('submit', { cancelable: true }));
  }

  // 關鍵字語意不清時：使用者選定後替換關鍵字欄位並重新執行（與法名相同的流程）。
  function replaceKeyword(text) {
    $('scopeKeyword').value = String(text || '').trim();
    $('scopeForm').dispatchEvent(new Event('submit', { cancelable: true }));
  }

  function setRunning(on) {
    $('scopeRun').disabled = on;
    $('scopeXlsx').disabled = on;
    $('scopeDocx').disabled = on;
  }

  /** 待覆核的格數（依據無法在判決原文中找到，或內容未取得）。 */
  function pendingCount(sheets) {
    var n = 0;
    (sheets || []).forEach(function (sh) {
      (sh.analyses || []).forEach(function (a) {
        (a.values || []).forEach(function (v) { if (v.reviewStatus === 'pending') n++; });
      });
    });
    return n;
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

  // ---- 覆核（v4）：每個操作送到主程序套用（核心純函式），並寫回「檔案」中的這筆結果。
  // 畫面只保存「還原上一步」需要的格子清單（會話內）；每個格子的操作紀錄保存在結果資料中，可隨時還原。
  var review = { busy: false };

  function canRunReview() {
    if (!review.busy) return true;
    JR.setStatus($('scopeStatus'), '覆核處理中，請稍候。', 'error');
    return false;
  }

  function reviewUi() {
    return {
      summaries: state.scopeSummaries || [],
      openPanels: state.scopeOpenPanels || {},
      editing: state.scopeEditing || null,
      filters: state.scopeFilters || {},
      canUndo: (state.scopeUndo || []).length > 0,
      actions: reviewActions
    };
  }

  function renderResult() { JR.views.renderScope(state.scopeSheets, reviewUi()); }

  function reviewMessage(op, n) {
    if (op.kind === 'accept') return '已接受 1 格。';
    if (op.kind === 'edit') return '已修改並接受（AI 原文保留，可還原）。';
    if (op.kind === 'reject') return '已駁回 1 格（內容保留，標示為已駁回）。';
    if (op.kind === 'batch-accept') return '已批次接受 ' + n + ' 格高信心結果（可用「還原上一步」撤銷）。';
    return '已還原 ' + n + ' 格。';
  }

  function sameCell(a, b) { return a.sheetIndex === b.sheetIndex && a.caseId === b.caseId && a.fieldId === b.fieldId; }

  /** 還原單一格時，從會話的還原清單中移除最近一筆該格的紀錄，避免之後的「還原上一步」重複撤銷。 */
  function removeOneFromStack(cell) {
    var stack = state.scopeUndo || [];
    for (var i = stack.length - 1; i >= 0; i--) {
      var idx = stack[i].findIndex(function (c) { return sameCell(c, cell); });
      if (idx >= 0) {
        stack[i].splice(idx, 1);
        if (stack[i].length === 0) stack.splice(i, 1);
        return;
      }
    }
  }

  function runReview(op, onFail) {
    if (!canRunReview()) { if (onFail) onFail(); return; }
    review.busy = true;
    var status = $('scopeStatus');
    var sheetsBefore = state.scopeSheets;
    api.scope.review({ libraryId: state.scopeLibraryId || null, sheets: sheetsBefore, op: op }).then(function (r) {
      // 執行中若已載入另一份結果，就不套用舊結果。
      if (state.scopeSheets !== sheetsBefore) return;
      state.scopeSheets = r.sheets;
      state.scopeSummaries = r.summaries;
      if (op.kind !== 'undo' && r.changed.length) state.scopeUndo.push(r.changed);
      renderResult();
      var msg = reviewMessage(op, r.changed.length);
      if (r.saveError) JR.setStatus(status, msg + '　' + r.saveError, 'error');
      else JR.setStatus(status, msg, 'ok');
    }).catch(function (err) {
      if (onFail) onFail();
      JR.setStatus(status, '覆核失敗：' + JR.errText(err), 'error');
    }).then(function () { review.busy = false; });
  }

  var reviewActions = {
    accept: function (cell) { runReview({ kind: 'accept', cell: cell }); },
    reject: function (cell) { runReview({ kind: 'reject', cell: cell }); },
    edit: function (cell, value) {
      if (!String(value || '').trim()) {
        JR.setStatus($('scopeStatus'), '修改後的內容不可為空白。', 'error');
        return;
      }
      state.scopeEditing = null;
      runReview({ kind: 'edit', cell: cell, value: value });
    },
    batch: function (si) { runReview({ kind: 'batch-accept', sheetIndex: si }); },
    undoLast: function () {
      if (!canRunReview()) return;
      var stack = state.scopeUndo || [];
      var cells = stack.pop();
      if (!cells) return;
      runReview({ kind: 'undo', cells: cells }, function () { stack.push(cells); });
    },
    undo: function (cells) {
      if (!canRunReview()) return;
      removeOneFromStack(cells[0]);
      runReview({ kind: 'undo', cells: cells });
    },
    startEdit: function (key) { state.scopeEditing = key; renderResult(); },
    cancelEdit: function () { state.scopeEditing = null; renderResult(); },
    togglePanel: function (key) {
      state.scopeOpenPanels[key] = !state.scopeOpenPanels[key];
      renderResult();
    },
    setFilter: function (si, value) { state.scopeFilters[si] = value; renderResult(); },
    /** 跳至原文（應用程式內）：取得判決全文（快取優先）並在視窗中定位依據；取得失敗或找不到時說明原因。 */
    openSource: function (judgmentId, quote) {
      var status = $('scopeStatus');
      JR.setStatus(status, '正在取得判決原文…');
      api.scope.judgmentText({ id: judgmentId, quote: quote }).then(function (view) {
        JR.components.judgmentDialog(view, quote);
        JR.setStatus(status, view && view.ok ? (view.message || '') : (view && view.error) || '', view && view.ok && view.span ? 'ok' : 'error');
      }).catch(function (err) {
        JR.setStatus(status, '無法開啟原文：' + JR.errText(err), 'error');
      });
    }
  };

  JR.controllers.scope = {
    /** 供助理與「檔案」頁面重新開啟結果；libraryId 為「檔案」中的項目 id（覆核狀態寫回用）。 */
    showResult: function (sheets, from, to, libraryId) {
      state.scopeSheets = sheets;
      state.scopeFrom = from;
      state.scopeTo = to;
      state.scopeLibraryId = libraryId || null;
      state.scopeUndo = [];
      state.scopeOpenPanels = {};
      state.scopeEditing = null;
      state.scopeFilters = {};
      state.scopeSummaries = null;
      renderResult();
      $('scopeXlsx').disabled = false;
      $('scopeDocx').disabled = false;
      // 取得覆核摘要（待覆核數、高信心數）；不改動結果。
      api.scope.review({ sheets: sheets }).then(function (r) {
        if (state.scopeSheets !== sheets) return;
        state.scopeSummaries = r.summaries;
        renderResult();
      }).catch(function () { /* 沒有摘要時仍可瀏覽結果 */ });
    },
    bind: function () {
      // 分析欄位設定：從設定讀入（預設集與自訂欄位、順序、勾選）。讀取失敗時使用預設欄位。
      api.settings.get().then(function (s) {
        JR.views.renderScopeFields(s.scopeFields || []);
      }).catch(function () {
        JR.views.renderScopeFields([]);
      });
      $('scopeFieldAdd').addEventListener('click', function () {
        $('scopeFieldList').appendChild(JR.components.codingFieldRow({ id: '', name: '', description: '', enabled: true }));
        $('scopeFieldList').lastChild.querySelector('.brief-field-name').focus();
      });

      $('scopeForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        if (JR.jobs.isBusy(PAGE)) {
          JR.setStatus($('scopeStatus'), '標編碼標注工序已有工作進行中，請等候完成或按「取消」。', 'error');
          return;
        }
        var statutes = statuteLines();
        var keyword = $('scopeKeyword').value.trim();
        var related = $('scopeRelated').value.trim();
        if (statutes.length === 0 && !keyword) {
          JR.setStatus($('scopeStatus'), '請輸入關鍵字，或至少一部法規。', 'error');
          return;
        }
        var aiOn = $('scopeAiOn').checked;
        var fieldRows = collectScopeFields();
        var fields = fieldRows.filter(function (f) { return f.enabled && f.name; }).map(function (f) { return { id: f.id, name: f.name, description: f.description }; });
        if (aiOn && fields.length === 0) {
          JR.setStatus($('scopeStatus'), '請至少勾選一個分析欄位。', 'error');
          return;
        }
        var from = Number($('scopeFrom').value) || undefined;
        var to = Number($('scopeTo').value) || undefined;
        var max = Number($('scopeMax').value) || 30;
        api.settings.set({ scopeFields: fieldRows.filter(function (f) { return f.name; }) }).catch(function (err) {
          JR.setStatus($('scopeStatus'), '欄位設定沒有保存：' + JR.errText(err), 'error');
        });
        setRunning(true);
        $('scopeResult').innerHTML = '';
        $('scopeProgress').hidden = false;
        state.scopeRunning = true;
        var runId = JR.jobs.start(PAGE, 'scopeCancel');
        JR.setStatus($('scopeStatus'), aiOn ? '確認中…（每則判決都會交由 AI 編碼）' : '確認中…（傳統篩選，不做 AI 分析）');
        try {
          JR.components.clarifyHide($('scopeClarify'));
          var r = await api.scope.run({
            runId: runId, statutes: statutes, keyword: keyword, relatedStatute: related, relatedOnly: $('scopeRelatedOnly').checked, smart: $('scopeSmart').checked,
            fields: fields, yearFrom: from, yearTo: to, maxItems: max,
            jurisdiction: $('scopeJurisdiction').value, ai: $('scopeAi').value, aiAnalysis: aiOn
          });
          state.scopeExplanation = r.explanation;
          $('scopeExplain').disabled = !r.explanation;
          if (r.status === 'ask') {
            var isKeyword = r.target === 'keyword';
            JR.components.clarifyBox($('scopeClarify'), {
              question: r.question,
              options: r.options,
              onPick: function (o) { if (isKeyword) replaceKeyword(o.label); else replaceStatuteLine(r.statuteLine, o.label); },
              onManual: function (text) { if (isKeyword) replaceKeyword(text); else replaceStatuteLine(r.statuteLine, text); },
              onCancel: function () { JR.setStatus($('scopeStatus'), isKeyword ? '已取消關鍵字選擇，沒有執行整理。' : '已取消法名選擇，沒有執行整理。'); }
            });
            JR.setStatus($('scopeStatus'), r.question);
            return;
          }
          JR.controllers.scope.showResult(r.sheets, from, to, r.libraryId);
          var total = r.sheets.reduce(function (n, s) { return n + s.rows.length; }, 0);
          // 把結果摘要交給助理，讓它能接著討論（助理只看得到對話紀錄，看不到畫面）。
          state.assistHistory.push({ role: 'user', text: '[系統通知] 標編碼標注工序已完成。' + r.sheets.map(function (sh) {
            return sh.statute + '共 ' + sh.rows.length + ' 筆：' + sh.rows.slice(0, 10).map(function (x, i) {
              var a = (sh.analyses || []).filter(function (y) { return y.id === x.id; })[0] || {};
              return (i + 1) + '. ' + x.title + '（' + (x.dateIso || '') + '）爭點：' + (a.issue || '') + '；引用：' + x.citedArticles.join('、');
            }).join(' ');
          }).join(' ') });
          var parts = [];
          parts.push(r.cancelled ? '已取消，保留已完成的 ' + total + ' 筆。' : '完成，共 ' + total + ' 筆。');
          var pending = pendingCount(r.sheets);
          if (pending) parts.push('有 ' + pending + ' 格待覆核（已標示於表格）。');
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
