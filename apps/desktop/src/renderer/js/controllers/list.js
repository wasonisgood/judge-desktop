// 控制器：判決列表（搜尋、AI 相關性篩選、匯出）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;

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
