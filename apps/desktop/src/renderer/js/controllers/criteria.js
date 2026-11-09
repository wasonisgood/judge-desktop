// 控制器：納入／排除核查頁。候選判決讀取（可取消）→ 標準設定 → 執行前規劃 → 確認後執行 → 結果、重新檢索、比較、匯出。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var PAGE = 'criteria';

  // 目前這一輪的狀態：候選判決的 prepId 只在主程序保存；規劃結果綁定當時的標準內容，標準變動即失效。
  var cur = { prepId: null, planKey: null, runs: [], run: null, fetching: false };

  function busyNotice() {
    JR.setStatus($('critFetchStatus'), '核查頁已有工作進行中，請等候完成或按「取消」。', 'error');
  }

  function readCriteria() {
    return Array.prototype.map.call($('critRows').children, function (row) { return row.readCriterion(); });
  }

  function invalidatePlan() {
    cur.planKey = null;
    $('critPlanBox').hidden = true;
    $('critPlanBox').innerHTML = '';
    $('critRun').disabled = true;
  }

  function setPlanEnabled() {
    $('critPlan').disabled = !cur.prepId || cur.fetching;
  }

  function addRow(c) {
    $('critRows').appendChild(JR.components.criteriaRow(c || { kind: 'include', method: 'ai' }));
    invalidatePlan();
  }

  function loadSources() {
    return api.library.list({ status: 'active' }).then(function (items) {
      var sel = $('critSource');
      var keep = sel.value;
      sel.innerHTML = '';
      var usable = (items || []).filter(function (it) { return it.kind === 'list' || it.kind === 'scope'; });
      if (!usable.length) {
        var none = document.createElement('option');
        none.value = '';
        none.textContent = '（沒有可用的來源：請先在判決列表搜尋，或完成範圍整理）';
        sel.appendChild(none);
      }
      usable.forEach(function (it) {
        var o = document.createElement('option');
        o.value = it.id;
        o.textContent = (JR.KIND_LABEL[it.kind] || it.kind) + '｜' + it.title + '（' + it.summary + '）';
        sel.appendChild(o);
      });
      if (keep && usable.some(function (it) { return it.id === keep; })) sel.value = keep;
      $('critFetch').disabled = !usable.length;
    }).catch(function (err) {
      JR.setStatus($('critFetchStatus'), '讀取來源失敗：' + JR.errText(err), 'error');
    });
  }

  /** 讀取候選判決（列表或範圍整理的來源，或重新檢索）。 */
  function fetchFrom(source) {
    if (JR.jobs.isBusy(PAGE)) { busyNotice(); return; }
    var runId = JR.jobs.start(PAGE, 'critCancel');
    cur.fetching = true;
    setPlanEnabled();
    JR.setStatus($('critFetchStatus'), '讀取候選判決中…（逐則取得全文，可隨時取消）');
    return api.criteria.fetch({ runId: runId, source: source }).then(function (r) {
      if (r.cancelled) {
        cur.prepId = null;
        invalidatePlan();
        JR.setStatus($('critFetchStatus'), '已取消，未讀取候選判決。');
        return;
      }
      cur.prepId = r.prepId;
      invalidatePlan();
      var msg = '已讀取 ' + r.total + ' 筆候選判決（' + r.label + '）。';
      if (r.withoutText) msg += ' 其中 ' + r.withoutText + ' 筆沒有取得全文，這些案件會列為需人工檢視。';
      if (r.notes && r.notes.length) msg += ' 注意：' + r.notes.join('；');
      JR.setStatus($('critFetchStatus'), msg, r.withoutText || (r.notes && r.notes.length) ? '' : 'ok');
    }).catch(function (err) {
      cur.prepId = null;
      invalidatePlan();
      JR.setStatus($('critFetchStatus'), '讀取失敗：' + JR.errText(err), 'error');
    }).finally(function () {
      JR.jobs.finish(PAGE);
      cur.fetching = false;
      setPlanEnabled();
    });
  }

  function renderPlan(p) {
    var box = $('critPlanBox');
    var plan = p.plan;
    box.innerHTML = '';
    box.hidden = false;
    var lines = [];
    lines.push('候選判決 ' + p.total + ' 筆。');
    if (p.hasAi) {
      lines.push('程式判斷已確定排除（不呼叫 AI）' + plan.skippedByProgram + ' 筆；需要 AI 判斷的案件 ' + plan.aiCases + ' 筆，共 ' + plan.aiCalls + ' 次 AI 呼叫。');
      if (p.costUsd !== null && p.costUsd !== undefined) {
        lines.push('依你在「設定」自行填寫的 AI 單價（US$ ' + p.usdPerMillion + ' / 百萬 token）粗估費用約 US$ ' + p.costUsd.toFixed(4) + '，以字數估算，實際費用以服務商帳單為準。');
      } else {
        lines.push('AI 單價未填寫（本工具沒有內建定價），因此只顯示 AI 呼叫次數，不估計費用。');
      }
    } else {
      lines.push('全部以程式判斷完成，不呼叫 AI。');
    }
    lines.forEach(function (t) { box.appendChild(JR.el('p', 'crit-plan-line', t)); });
    $('critRun').disabled = false;
  }

  function plan() {
    if (!cur.prepId) return;
    var criteria;
    try {
      criteria = readCriteria();
    } catch (err) {
      JR.setStatus($('critRunStatus'), err.message, 'error');
      return;
    }
    var key = JSON.stringify(criteria) + '|' + cur.prepId;
    JR.setStatus($('critRunStatus'), '規劃中…');
    return api.criteria.plan({ prepId: cur.prepId, criteria: criteria }).then(function (p) {
      cur.planKey = key;
      renderPlan(p);
      JR.setStatus($('critRunStatus'), '請確認上方規劃後再執行。');
    }).catch(function (err) {
      invalidatePlan();
      JR.setStatus($('critRunStatus'), '規劃失敗：' + JR.errText(err), 'error');
    });
  }

  function showRunByNo(no) {
    var r = cur.runs.filter(function (x) { return x.runNo === Number(no); })[0];
    if (!r) {
      cur.run = null;
      JR.views.clearRun();
      JR.views.renderReview(null);
      $('critExport').disabled = true;
      $('critReview').disabled = true;
      return;
    }
    cur.run = r;
    JR.views.renderRun(r);
    JR.views.renderReview(r.review || null);
    $('critExport').disabled = false;
    $('critReview').disabled = false;
  }

  /** AI 檢閱（只在研究者按下時呼叫）。服務錯誤直接告知，不做任何自動決定。 */
  function review() {
    if (!cur.run) return;
    if (JR.jobs.isBusy(PAGE)) { busyNotice(); return; }
    var runNo = cur.run.runNo;
    var runId = JR.jobs.start(PAGE, 'critCancel');
    $('critReview').disabled = true;
    JR.setStatus($('critResultStatus'), 'AI 檢閱中…（只傳送結果摘要）');
    return api.criteria.review({ runId: runId, runNo: runNo, ai: $('critAi').value }).then(function (r) {
      var stored = cur.runs.filter(function (x) { return x.runNo === runNo; })[0];
      if (stored) stored.review = r.review;
      if (cur.run && cur.run.runNo === runNo) JR.views.renderReview(r.review);
      JR.setStatus($('critResultStatus'), r.review.verdict === 'unclear' ? 'AI 檢閱沒有得出結論。' : 'AI 檢閱完成。', r.review.verdict === 'unclear' ? 'error' : 'ok');
    }).catch(function (err) {
      JR.setStatus($('critResultStatus'), 'AI 檢閱失敗：' + JR.errText(err) + '。未做任何重新檢索的決定，請稍後再試。', 'error');
    }).finally(function () {
      JR.jobs.finish(PAGE);
      $('critReview').disabled = !cur.run;
    });
  }

  function loadRuns(selectNo) {
    return api.criteria.runs().then(function (runs) {
      cur.runs = runs || [];
      var latest = cur.runs.length ? cur.runs[cur.runs.length - 1].runNo : null;
      var pick = selectNo || latest;
      // 比較預設為前一次（與查看的不同），方便直接比較重新檢索前後的結果。
      var previous = cur.runs.length > 1 ? cur.runs[cur.runs.length - 2].runNo : null;
      JR.views.renderRunOptions(cur.runs, pick, previous);
      showRunByNo(pick);
    }).catch(function (err) {
      JR.setStatus($('critResultStatus'), '讀取核查紀錄失敗：' + JR.errText(err), 'error');
    });
  }

  function doRun() {
    if (!cur.prepId || !cur.planKey) return;
    if (cur.planKey !== JSON.stringify(readCriteria()) + '|' + cur.prepId) {
      JR.setStatus($('critRunStatus'), '標準已變動，請重新規劃後再執行。', 'error');
      invalidatePlan();
      return;
    }
    if (JR.jobs.isBusy(PAGE)) { busyNotice(); return; }
    var runId = JR.jobs.start(PAGE, 'critCancel');
    $('critRun').disabled = true;
    JR.setStatus($('critRunStatus'), '核查中…（AI 判斷逐案進行；取消會放棄這次結果）');
    return api.criteria.run({ runId: runId, prepId: cur.prepId, criteria: readCriteria(), ai: $('critAi').value }).then(function (r) {
      if (r.cancelled) { JR.setStatus($('critRunStatus'), '已取消，這次核查沒有保存。', 'error'); return; }
      var msg = '核查完成，已保存為第 ' + r.run.runNo + ' 次。';
      if (r.saveError) msg += ' ' + r.saveError;
      JR.setStatus($('critRunStatus'), msg, r.saveError ? 'error' : 'ok');
      loadRuns(r.run.runNo);
    }).catch(function (err) {
      JR.setStatus($('critRunStatus'), '核查失敗：' + JR.errText(err), 'error');
    }).finally(function () {
      JR.jobs.finish(PAGE);
      // 每次執行後都要重新規劃，避免同一份規劃被重複執行。
      cur.planKey = null;
      $('critRun').disabled = true;
    });
  }

  function compare() {
    var a = cur.runs.filter(function (x) { return x.runNo === Number($('critRunSel').value); })[0];
    var b = cur.runs.filter(function (x) { return x.runNo === Number($('critCompareSel').value); })[0];
    if (!a || !b) return;
    if (a.runNo === b.runNo) { JR.setStatus($('critResultStatus'), '請選擇兩次不同的核查來比較。', 'error'); return; }
    return api.criteria.compare({ aNo: a.runNo, bNo: b.runNo }).then(function (cmp) {
      JR.views.renderCompare(cmp, a, b);
    }).catch(function (err) {
      JR.setStatus($('critResultStatus'), '比較失敗：' + JR.errText(err), 'error');
    });
  }

  JR.controllers.criteria = {
    load: function () {
      loadSources();
      if (!$('critRows').children.length) { addRow({ kind: 'include', method: 'ai' }); addRow({ kind: 'exclude', method: 'program' }); }
      loadRuns();
      setPlanEnabled();
    },
    bind: function () {
      $('critSourceForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var id = $('critSource').value;
        if (!id) { JR.setStatus($('critFetchStatus'), '請先在判決列表搜尋，或完成範圍整理。', 'error'); return; }
        fetchFrom({ kind: 'library', id: id });
      });
      $('critRefresh').addEventListener('click', loadSources);
      $('critSearchForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var q = $('critQuery').value.trim();
        if (!q) { JR.setStatus($('critFetchStatus'), '請輸入新的關鍵字。', 'error'); return; }
        fetchFrom({ kind: 'search', query: q, maxItems: Number($('critMax').value) || 20 });
      });
      // 取消按鈕由 JR.jobs.init 統一綁定（critCancel → criteria）。
      $('critAdd').addEventListener('click', function () { addRow({ kind: 'include', method: 'ai' }); });
      // 標準列的任何變動（含移除）都讓規劃失效，必須重新規劃後才能執行。
      $('critRows').addEventListener('input', invalidatePlan);
      $('critRows').addEventListener('change', invalidatePlan);
      $('critPlan').addEventListener('click', plan);
      $('critRun').addEventListener('click', doRun);
      $('critRunSel').addEventListener('change', function () { showRunByNo($('critRunSel').value); });
      $('critCompare').addEventListener('click', compare);
      $('critReview').addEventListener('click', review);
      $('critExport').addEventListener('click', async function () {
        if (!cur.run) return;
        try {
          var r = await api.criteria.export({ runNo: cur.run.runNo });
          if (!r.canceled) JR.setStatus($('critResultStatus'), '已匯出：' + r.filePath, 'ok');
        } catch (err) {
          JR.setStatus($('critResultStatus'), '匯出失敗：' + JR.errText(err), 'error');
        }
      });
      api.criteria.onProgress(function (p) {
        if (!JR.jobs.isBusy(PAGE)) return;
        var text = (p.phase === 'fetch' ? '讀取全文 ' : '核查 ') + p.done + ' / ' + p.total;
        JR.setStatus(p.phase === 'fetch' ? $('critFetchStatus') : $('critRunStatus'), text);
      });
    }
  };
})(window.JR);
