// 控制器：檔案頁（分頁切換、讀取列表、狀態變更、永久刪除、重新開啟）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;

  function load() {
    JR.views.clearFiles();
    return api.library.list({ status: state.fileTab }).then(function (items) {
      JR.views.renderFiles(items, state.fileTab, handlers);
    }, JR.views.setFilesError);
  }

  /** 開啟已保存的項目：切換到對應頁面並還原結果。 */
  function openItem(it) {
    var p = it.payload || {};
    if (it.kind === 'list') {
      state.listItems = p.items || [];
      state.listDetails = p.details || {};
      state.listKeyword = p.keyword || '';
      JR.views.renderList(state.listItems);
      $('listKeyword').value = state.listKeyword;
      $('listExport').disabled = state.listItems.length === 0;
      JR.setStatus($('listStatus'), '已從「檔案」開啟。', 'ok');
      JR.nav.showPage('list');
    } else if (it.kind === 'scope') {
      JR.controllers.scope.showResult(p.sheets || [], p.yearFrom, p.yearTo);
      JR.setStatus($('scopeStatus'), '已從「檔案」開啟。', 'ok');
      JR.nav.showPage('scope');
    } else if (it.kind === 'brief') {
      JR.controllers.brief.showResult(p);
      JR.setStatus($('briefStatus'), '已從「檔案」開啟。', 'ok');
      JR.nav.showPage('brief');
    }
  }

  async function patch(it, p) {
    try {
      await api.library.update({ id: it.id, patch: p });
      load();
    } catch (err) {
      JR.setStatus($('filesStatus'), '更新失敗：' + JR.errText(err), 'error');
    }
  }

  var handlers = {
    open: openItem,
    patch: patch,
    remove: function (it) {
      api.library.remove({ id: it.id }).then(load).catch(function (err) {
        JR.setStatus($('filesStatus'), '刪除失敗：' + JR.errText(err), 'error');
      });
    }
  };

  JR.controllers.files = {
    load: load,
    bind: function () {
      document.querySelectorAll('.tab').forEach(function (t) {
        t.addEventListener('click', function () {
          state.fileTab = t.dataset.tab;
          document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
          load();
        });
      });
    }
  };
})(window.JR);
