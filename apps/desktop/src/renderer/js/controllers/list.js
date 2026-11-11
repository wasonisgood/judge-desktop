// 控制器：判決列表（搜尋、智慧搜尋、手動輸入、AI 篩選、匯出）。v3.6.0：單頁同時只一項工作、可取消、結果過期不覆寫。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;
  var PAGE = 'list';

  function busyNotice() {
    JR.setStatus($('listStatus'), '列表已有工作進行中，請等候完成或按「取消」。', 'error');
  }

  function noteText(r) {
    var parts = [];
    if (r.cancelled) parts.push('已取消，保留已完成的部分。');
    if ((r.notes || []).length) parts.push('注意：' + r.notes.join('；'));
    if (r.saveError) parts.push(r.saveError);
    return parts.join('　');
  }

  // 列表結果：顯示列表並自動出圖（列表沒有法院欄，由字號推出）。
  function showListItems(items) {
    JR.views.renderList(items);
    JR.controllers.resultCharts.show('listCharts', (items || []).map(function (it) {
      return { id: it.id, title: it.title || '', court: '', dateIso: it.dateIso || null, cause: it.cause || '', caseType: '' };
    }));
  }

  function setRunning(on) {
    $('listRun').disabled = on;
    $('listExport').disabled = on;
    $('listScreen').disabled = on || !state.listItems || state.listItems.length === 0;
  }

  // ---- 智慧搜尋（issue #4）：有上限的重試；語意不清時顯示選項（含取消），最後一項可自行輸入更正 ----
  function smartRun(request) {
    if (JR.jobs.isBusy(PAGE)) { busyNotice(); return; }
    var status = $('listStatus');
    var seq = ++state.listSeq;
    JR.components.clarifyHide($('listClarify'));
    setRunning(true);
    var runId = JR.jobs.start(PAGE, 'listCancel');
    JR.setStatus(status, '智慧搜尋中…（依結果自動調整關鍵字，最多 3 輪）');
    return api.search.smart({
      runId: runId,
      request: request,
      statute: $('listStatute').value.trim(),
      jurisdiction: $('listJurisdiction').value,
      maxItems: Number($('listMax').value) || 20,
      ai: $('listAi').value
    }).then(function (r) {
      if (seq !== state.listSeq) return;
      state.listExplanation = r.explanation;
      $('listExplain').disabled = false;
      if (r.items.length) {
        state.listItems = r.items;
        state.listDetails = {};
        state.listKeyword = request;
        state.listVerdicts = null;
        showListItems(r.items);
      }
      if (r.status === 'ask') {
        JR.components.clarifyBox($('listClarify'), {
          question: r.question,
          options: r.options,
          onPick: function (o) { smartRun(o.label); },
          onManual: function (text) { smartRun(text); },
          onCancel: function () { JR.setStatus(status, '已取消選擇，沒有執行新的搜尋。'); }
        });
        JR.setStatus(status, r.question);
        return;
      }
      var head = r.items.length ? '找到 ' + r.items.length + ' 筆，已存入「檔案」。' : '沒有找到符合的判決。';
      var tail = r.status === 'capped' ? ' ' + r.advice : '';
      var extra = noteText(r);
      var ok = r.items.length && r.status !== 'capped' && !r.cancelled && !r.saveError;
      JR.setStatus(status, head + tail + (extra ? '　' + extra : ''), ok ? 'ok' : (r.cancelled || r.status === 'capped' || r.saveError ? 'error' : ''));
    }).catch(function (err) {
      if (seq === state.listSeq) JR.setStatus(status, '智慧搜尋失敗：' + JR.errText(err), 'error');
    }).finally(function () {
      JR.jobs.finish(PAGE);
      if (seq === state.listSeq) setRunning(false);
    });
  }

  JR.controllers.list = {
    /** 供「檔案」頁顯示已保存的列表結果（同時出圖）。 */
    showItems: showListItems,
    bind: function () {
      $('listShowAll').addEventListener('change', function () { if (state.listItems) showListItems(state.listItems); });

      $('listScreen').addEventListener('click', async function () {
        if (!state.listItems || state.listItems.length === 0) return;
        if (JR.jobs.isBusy(PAGE)) { busyNotice(); return; }
        var items = state.listItems;
        var seq = ++state.listSeq;
        var btn = $('listScreen');
        btn.disabled = true;
        var runId = JR.jobs.start(PAGE, 'listCancel');
        JR.setStatus($('listScreenStatus'), 'AI 篩選中…（只依字號、案由與日期判斷，不讀全文）');
        try {
          var topic = state.listKeyword || $('listKeyword').value.trim();
          var verdicts = await api.search.screen({
            runId: runId,
            topic: topic,
            items: items.map(function (it) { return { id: it.id, title: it.title, cause: it.cause || '', dateIso: it.dateIso || null }; }),
            ai: $('listAi').value
          });
          if (seq !== state.listSeq || items !== state.listItems) {
            JR.setStatus($('listScreenStatus'), '列表已更新，本次篩選結果已捨棄，請重新篩選。', 'error');
            return;
          }
          state.listVerdicts = verdicts;
          $('listShowAll').checked = false;
          showListItems(state.listItems);
          JR.setStatus($('listScreenStatus'), 'AI 篩選完成。', 'ok');
        } catch (err) {
          JR.setStatus($('listScreenStatus'), 'AI 篩選失敗：' + JR.errText(err), 'error');
        } finally {
          JR.jobs.finish(PAGE);
          btn.disabled = !state.listItems || state.listItems.length === 0;
        }
      });

      $('listForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        if (JR.jobs.isBusy(PAGE)) { busyNotice(); return; }
        var keyword = $('listKeyword').value.trim();
        // 自然語言：由 AI 整理成關鍵字、法規與智慧搜尋開關，回填到表單後照常執行（使用者看得到轉換結果）。
        var nl;
        try {
          nl = await JR.nl.interpret(PAGE, keyword, $('listAi').value);
        } catch (err) {
          JR.setStatus($('listStatus'), JR.errText(err), 'error');
          return;
        }
        if (nl.mode === 'natural') {
          if (nl.fields.keyword) $('listKeyword').value = nl.fields.keyword;
          if (nl.fields.statute) $('listStatute').value = nl.fields.statute;
          if (nl.fields.smart) $('listSmart').checked = true;
          keyword = $('listKeyword').value.trim();
          JR.setStatus($('listStatus'), '已將描述整理為關鍵字「' + keyword + '」' + ($('listStatute').value ? '、法規「' + $('listStatute').value + '」' : '') + '。');
        }
        if ($('listSmart').checked) return smartRun(keyword);
        if (JR.jobs.isBusy(PAGE)) { busyNotice(); return; }
        var full = $('listFull').checked;
        var progress = $('listProgress');
        var seq = ++state.listSeq;
        setRunning(true);
        var runId = JR.jobs.start(PAGE, 'listCancel');
        JR.setStatus($('listStatus'), '搜尋中…');
        progress.hidden = !full;
        progress.querySelector('.bar').style.width = '0%';
        try {
          var r = await api.search.run({
            runId: runId,
            keyword: keyword,
            jurisdiction: $('listJurisdiction').value,
            courtCode: $('listCourt').value.trim(),
            maxItems: Number($('listMax').value) || 20,
            includeFullText: full
          });
          if (seq !== state.listSeq) return;
          state.listItems = r.items;
          state.listDetails = r.details;
          state.listKeyword = keyword;
          state.listVerdicts = null;
          $('listScreen').disabled = r.items.length === 0;
          showListItems(r.items);
          var extra = noteText(r);
          var msg = r.items.length ? '找到 ' + r.items.length + ' 筆，已存入「檔案」。' : '沒有找到符合的判決，請換個關鍵字再試。';
          JR.setStatus($('listStatus'), msg + (extra ? '　' + extra : ''), r.items.length && !r.cancelled && !r.saveError ? 'ok' : 'error');
          $('listExport').disabled = r.items.length === 0;
        } catch (err) {
          if (seq === state.listSeq) JR.setStatus($('listStatus'), '搜尋失敗：' + JR.errText(err), 'error');
        } finally {
          JR.jobs.finish(PAGE);
          progress.hidden = true;
          if (seq === state.listSeq) setRunning(false);
        }
      });

      // 手動輸入判決：每行一則網址或 ID，結果與搜尋使用同一個列表與匯出流程。
      $('manualForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        if (JR.jobs.isBusy(PAGE)) { JR.setStatus($('manualStatus'), '列表已有工作進行中，請等候完成或按「取消」。', 'error'); return; }
        var seq = ++state.listSeq;
        $('manualRun').disabled = true;
        setRunning(true);
        var runId = JR.jobs.start(PAGE, 'listCancel');
        JR.setStatus($('manualStatus'), '取得判決資料中…');
        try {
          var r = await api.search.manual({ runId: runId, text: $('manualIds').value, jurisdiction: $('listJurisdiction').value });
          if (seq !== state.listSeq) return;
          state.listItems = r.items;
          state.listDetails = r.details;
          state.listKeyword = '手動輸入';
          state.listVerdicts = null;
          $('listScreen').disabled = r.items.length === 0;
          showListItems(r.items);
          $('listExport').disabled = r.items.length === 0;
          var extra = noteText(r);
          if (r.items.length) JR.setStatus($('manualStatus'), '已產生 ' + r.items.length + ' 筆，已存入「檔案」。' + (extra ? '　' + extra : ''), r.cancelled || r.saveError ? 'error' : 'ok');
          else JR.setStatus($('manualStatus'), '沒有可用的判決。請確認每行是判決網址或 ID。' + (extra ? '　' + extra : ''), 'error');
        } catch (err) {
          if (seq === state.listSeq) JR.setStatus($('manualStatus'), '產生失敗：' + JR.errText(err), 'error');
        } finally {
          JR.jobs.finish(PAGE);
          $('manualRun').disabled = false;
          if (seq === state.listSeq) setRunning(false);
        }
      });

      api.search.onProgress(function (p) {
        if (!JR.jobs.isBusy(PAGE)) return;
        $('listProgress').querySelector('.bar').style.width = Math.round((p.done / p.total) * 100) + '%';
      });

      $('listExplain').addEventListener('click', function () {
        if (state.listExplanation) JR.components.explainDialog(state.listExplanation);
      });

      $('listExport').addEventListener('click', async function () {
        try {
          var r = await api.exportList({ keyword: state.listKeyword, items: state.listItems, details: state.listDetails || {} });
          if (!r.canceled) JR.setStatus($('listStatus'), '已匯出：' + r.filePath, 'ok');
        } catch (err) {
          JR.setStatus($('listStatus'), '匯出失敗：' + JR.errText(err), 'error');
        }
      });
    }
  };
})(window.JR);
