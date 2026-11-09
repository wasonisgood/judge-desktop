// 控制器：判決列表（搜尋、AI 相關性篩選、匯出）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;

  // ---- 智慧搜尋（issue #4）：有上限的重試；語意不清時顯示選項（共用元件），最後一項可自行輸入更正 ----
  function smartRun(request) {
    var status = $('listStatus');
    $('listRun').disabled = true;
    $('listExport').disabled = true;
    JR.components.clarifyHide($('listClarify'));
    JR.setStatus(status, '智慧搜尋中…（依結果自動調整關鍵字，最多 3 輪）');
    return api.search.smart({
      request: request,
      statute: $('listStatute').value.trim(),
      jurisdiction: $('listJurisdiction').value,
      maxItems: Number($('listMax').value) || 20,
      ai: $('listAi').value
    }).then(function (r) {
      state.listExplanation = r.explanation;
      $('listExplain').disabled = false;
      if (r.items.length) {
        state.listItems = r.items;
        state.listDetails = {};
        state.listKeyword = request;
        state.listVerdicts = null;
        $('listScreen').disabled = false;
        $('listExport').disabled = false;
        JR.views.renderList(r.items);
      }
      if (r.status === 'ask') {
        JR.components.clarifyBox($('listClarify'), {
          question: r.question,
          options: r.options,
          onPick: function (o) { smartRun(o.label); },
          onManual: function (text) { smartRun(text); }
        });
        JR.setStatus(status, r.question);
        return;
      }
      var tail = r.status === 'capped' ? ' ' + r.advice : '';
      var head = r.items.length ? '找到 ' + r.items.length + ' 筆，已存入「檔案」。' : '沒有找到符合的判決。';
      JR.setStatus(status, head + tail, r.items.length && r.status !== 'capped' ? 'ok' : (r.status === 'capped' ? 'error' : ''));
    }).catch(function (err) {
      JR.setStatus(status, '智慧搜尋失敗：' + JR.errText(err), 'error');
    }).finally(function () {
      $('listRun').disabled = false;
    });
  }

  JR.controllers.list = {
    bind: function () {
      $('listShowAll').addEventListener('change', function () { if (state.listItems) JR.views.renderList(state.listItems); });

      $('listScreen').addEventListener('click', async function () {
        if (!state.listItems || state.listItems.length === 0) return;
        var btn = $('listScreen');
        btn.disabled = true;
        JR.setStatus($('listScreenStatus'), 'AI 篩選中…（只依字號、案由與日期判斷，不讀全文）');
        try {
          var topic = state.listKeyword || $('listKeyword').value.trim();
          state.listVerdicts = await api.search.screen({
            topic: topic,
            items: state.listItems.map(function (it) { return { id: it.id, title: it.title, cause: it.cause || '', dateIso: it.dateIso || null }; }),
            ai: $('listAi').value
          });
          $('listShowAll').checked = false;
          JR.views.renderList(state.listItems);
          JR.setStatus($('listScreenStatus'), $('listScreenStatus').textContent, 'ok');
        } catch (err) {
          JR.setStatus($('listScreenStatus'), 'AI 篩選失敗：' + JR.errText(err), 'error');
        } finally {
          btn.disabled = false;
        }
      });

      $('listForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var keyword = $('listKeyword').value.trim();
        if ($('listSmart').checked) return smartRun(keyword);
        var full = $('listFull').checked;
        var progress = $('listProgress');
        $('listRun').disabled = true;
        $('listExport').disabled = true;
        JR.setStatus($('listStatus'), '搜尋中…');
        progress.hidden = !full;
        progress.querySelector('.bar').style.width = '0%';
        try {
          var r = await api.search.run({
            keyword: keyword,
            jurisdiction: $('listJurisdiction').value,
            courtCode: $('listCourt').value.trim(),
            maxItems: Number($('listMax').value) || 20,
            includeFullText: full
          });
          state.listItems = r.items;
          state.listDetails = r.details;
          state.listKeyword = keyword;
          state.listVerdicts = null;
          $('listScreen').disabled = r.items.length === 0;
          JR.views.renderList(r.items);
          JR.setStatus($('listStatus'), r.items.length ? '找到 ' + r.items.length + ' 筆，已存入「檔案」。' : '沒有找到符合的判決，請換個關鍵字再試。', r.items.length ? 'ok' : '');
          $('listExport').disabled = r.items.length === 0;
        } catch (err) {
          JR.setStatus($('listStatus'), '搜尋失敗：' + JR.errText(err), 'error');
        } finally {
          $('listRun').disabled = false;
          progress.hidden = true;
        }
      });

      // 手動輸入判決：每行一則網址或 ID，結果與搜尋使用同一個列表與匯出流程。
      $('manualForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        $('manualRun').disabled = true;
        $('listExport').disabled = true;
        JR.setStatus($('manualStatus'), '取得判決資料中…');
        try {
          var r = await api.search.manual({ text: $('manualIds').value, jurisdiction: $('listJurisdiction').value });
          state.listItems = r.items;
          state.listDetails = r.details;
          state.listKeyword = '手動輸入';
          state.listVerdicts = null;
          $('listScreen').disabled = r.items.length === 0;
          JR.views.renderList(r.items);
          $('listExport').disabled = r.items.length === 0;
          var notes = (r.notes || []).length ? '　注意：' + r.notes.join('；') : '';
          if (r.items.length) JR.setStatus($('manualStatus'), '已產生 ' + r.items.length + ' 筆，已存入「檔案」。' + notes, 'ok');
          else JR.setStatus($('manualStatus'), '沒有可用的判決。請確認每行是判決網址或 ID。' + notes, 'error');
        } catch (err) {
          JR.setStatus($('manualStatus'), '產生失敗：' + JR.errText(err), 'error');
        } finally {
          $('manualRun').disabled = false;
        }
      });
      api.search.onProgress(function (p) {
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
