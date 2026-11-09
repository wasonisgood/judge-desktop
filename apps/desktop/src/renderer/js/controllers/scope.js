// 控制器：標編碼標注工序（範圍整理表；執行、可取消、進度、匯出）。結果交給助理作為上下文（助理看不到畫面）。
// v3.6.0：單頁同時只一項工作；取消保留已完成部分；存檔失敗明確提示；法名選項可取消。
// v3.8：關鍵字入口（自然語言、智慧搜尋、相關法規）與分析欄位設定（預設集、自訂、排序）保存在設定中。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;
  var PAGE = 'scope';
  // 尚未接入的功能：等對應分支合併後才會出現在流程中，這裡只說明，不產生任何處理步驟。
  var PENDING_NOTES = [
    '案件類型篩選：尚未接入，等案件類型分支（feat/case-type-handoff）合併後接入。',
    '覆核：尚未接入，等覆核 UI 分支（feat/coding-review）合併後接入。'
  ];

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

  // ---- 前置條件：按鈕與欄位的可用狀態由主程序的純函式決定（core scopeUiState），這裡只套用到畫面 ----
  var gateSeq = 0;
  var gateTimer = null;

  function controlInput() {
    var fields = collectScopeFields().filter(function (f) { return f.enabled && f.name; });
    return {
      statutes: statuteLines(),
      keyword: $('scopeKeyword').value.trim(),
      relatedStatute: $('scopeRelated').value.trim(),
      relatedOnly: $('scopeRelatedOnly').checked,
      smart: $('scopeSmart').checked,
      aiOn: $('scopeAiOn').checked,
      fieldCount: fields.length,
      running: !!state.scopeRunning,
      hasResult: !!(state.scopeSheets && state.scopeSheets.length),
      hasExplanation: !!state.scopeExplanation
    };
  }

  function setGate(id, gate) {
    var b = $(id);
    b.disabled = !gate.enabled;
    b.title = gate.reason || '';
  }

  function setMsg(id, gate) {
    $(id).textContent = gate.enabled ? '' : gate.reason;
  }

  function applyGates(ui, input) {
    var g = ui.gates;
    // 尚未執行、沒有結果時，流程面板顯示依輸入決定的初始狀態。
    if (!input.running && !input.hasResult) state.scopeFlow = ui.flow;
    setGate('scopeRun', g.run);
    setGate('scopeXlsx', g.exportFile);
    setGate('scopeDocx', g.exportFile);
    setGate('scopeExplain', g.explain);
    $('scopeSmart').disabled = !g.smart.enabled;
    setMsg('scopeSmartMsg', g.smart);
    $('scopeRelatedOnly').disabled = !g.relatedOnly.enabled;
    setMsg('scopeRelatedOnlyMsg', g.relatedOnly);
    ['scopeJurisdiction', 'scopeKeyword', 'scopeLines', 'scopeRelated', 'scopeFrom', 'scopeTo', 'scopeMax', 'scopeAiOn', 'scopeAi', 'scopeFieldAdd'].forEach(function (id) {
      $(id).disabled = !g.input.enabled;
    });
    document.querySelectorAll('#scopeResult .scope-block button').forEach(function (b) {
      b.disabled = !g.brief.enabled;
      b.title = g.brief.reason || '';
    });
    var rows = document.querySelectorAll('#scopeFieldList .coding-field-row');
    rows.forEach(function (row, idx) {
      var btns = row.querySelectorAll('.coding-field-actions button');
      var editable = g.fieldEdit.enabled;
      btns[0].disabled = !editable || idx === 0;
      btns[1].disabled = !editable || idx === rows.length - 1;
      btns[2].disabled = !editable;
      row.querySelectorAll('input').forEach(function (i) { i.disabled = !editable; });
    });
    // 一句話說明：列出停用中的按鈕原因（不重複）。
    var reasons = [];
    [g.run, g.exportFile, g.explain].forEach(function (gate) {
      if (!gate.enabled && gate.reason && reasons.indexOf(gate.reason) < 0) reasons.push(gate.reason);
    });
    $('scopeActionHint').textContent = reasons.length ? reasons.join('；') + '。' : '';
  }

  /** 依目前輸入重新計算前置條件；快速連續輸入時只套用最後一次的結果。 */
  function refreshControls() {
    var n = ++gateSeq;
    var input = controlInput();
    return api.scope.controls(input).then(function (ui) {
      if (n === gateSeq) applyGates(ui, input);
    }).catch(function () { /* 無法取得前置條件時維持目前的按鈕狀態 */ });
  }

  function scheduleRefresh() {
    clearTimeout(gateTimer);
    gateTimer = setTimeout(refreshControls, 0);
  }

  function setRunning(on) {
    state.scopeRunning = on;
    refreshControls();
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

  JR.controllers.scope = {
    /**
     * 從「檔案」開啟已保存的結果：流程與說明隨結果保存。舊結果沒有流程紀錄時，明確說明它產生於紀錄功能加入之前。
     * 先設定流程狀態，再顯示結果（按鈕前置條件會讀取這些狀態）。
     */
    showSaved: function (p) {
      state.scopeExplanation = p.explanation || {
        title: '標編碼標注工序：處理流程說明',
        paragraphs: ['此結果產生於紀錄功能加入之前，沒有處理流程紀錄。']
      };
      state.scopeFlow = p.flow || [];
      JR.controllers.scope.showResult(p.sheets || [], p.yearFrom, p.yearTo);
    },
    /** 供助理與「檔案」頁面重新開啟結果。 */
    showResult: function (sheets, from, to) {
      state.scopeSheets = sheets;
      state.scopeFrom = from;
      state.scopeTo = to;
      JR.views.renderScope(sheets);
      refreshControls();
    },
    bind: function () {
      // 分析欄位設定：從設定讀入（預設集與自訂欄位、順序、勾選）。讀取失敗時使用預設欄位。
      api.settings.get().then(function (s) {
        JR.views.renderScopeFields(s.scopeFields || []);
      }).catch(function () {
        JR.views.renderScopeFields([]);
      }).then(refreshControls);
      $('scopeFieldAdd').addEventListener('click', function () {
        $('scopeFieldList').appendChild(JR.components.codingFieldRow({ id: '', name: '', description: '', enabled: true }));
        $('scopeFieldList').lastChild.querySelector('.brief-field-name').focus();
        scheduleRefresh();
      });
      // 任何輸入、勾選或欄位排序的變化，都重新計算前置條件。
      ['input', 'change', 'click'].forEach(function (ev) {
        $('scopeForm').addEventListener(ev, scheduleRefresh);
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
        state.scopeExplanation = null;
        state.scopeFlow = null;
        setRunning(true);
        $('scopeResult').innerHTML = '';
        $('scopeProgress').hidden = false;
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
          state.scopeFlow = r.flow;
          if (state.scopeDialog) state.scopeDialog.update({ title: r.explanation.title, paragraphs: r.explanation.paragraphs, flow: r.flow });
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
          JR.controllers.scope.showResult(r.sheets, from, to);
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
        // 流程面板即時跟著目前的階段與每一步的紀錄更新（開著說明視窗時）。
        if (p.flow) {
          state.scopeFlow = p.flow;
          if (state.scopeDialog) state.scopeDialog.update({ flow: p.flow });
        }
        // 只有紀錄更新（沒有階段名稱）時，不改動狀態列。
        if (!p.phase) return;
        $('scopeProgress').querySelector('.bar').style.width = Math.round((p.done / Math.max(p.total, 1)) * 100) + '%';
        JR.setStatus($('scopeStatus'), '「' + p.statute + '」' + p.phase + '：' + p.done + ' / ' + p.total);
      });
      $('scopeExplain').addEventListener('click', function () {
        // 執行中顯示即時流程；執行結束後顯示完整紀錄（說明文字來自流程紀錄）。
        var base = state.scopeExplanation || { title: '標編碼標注工序：處理流程說明', paragraphs: ['整理完成後會顯示每一步的完整處理紀錄。'] };
        state.scopeDialog = JR.components.explainDialog(Object.assign({}, base, { flow: state.scopeFlow || [], notes: PENDING_NOTES }));
      });
      $('scopeXlsx').addEventListener('click', function () { exportScope('xlsx'); });
      $('scopeDocx').addEventListener('click', function () { exportScope('docx'); });
    }
  };
})(window.JR);
