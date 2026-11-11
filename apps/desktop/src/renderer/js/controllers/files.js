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
      JR.controllers.list.showItems(state.listItems);
      $('listKeyword').value = state.listKeyword;
      $('listExport').disabled = state.listItems.length === 0;
      JR.setStatus($('listStatus'), '已從「檔案」開啟。', 'ok');
      JR.nav.showPage('list');
    } else if (it.kind === 'scope') {
      JR.controllers.scope.showSaved(p, it.id);
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
    /** 助理用：依 id 開啟已保存的項目（與在列表中按「開啟」相同）。 */
    openById: function (id) {
      return api.library.list({}).then(function (items) {
        var it = (items || []).filter(function (x) { return x.id === id; })[0];
        if (!it) throw new Error('找不到已保存的項目');
        openItem(it);
      });
    },
    bind: function () {
      $('fileImport').addEventListener('click', function () {
        JR.setStatus($('filesStatus'), '請選擇檔案（Excel、CSV、Word、PDF、TXT 皆可）…');
        api.importFile({}).then(function (r) {
          if (r.canceled) { JR.setStatus($('filesStatus'), '已取消匯入。'); return; }
          var msg = '已匯入 ' + r.count + ' 筆判決（' + r.fileName + '），已存入「使用中」。' + (r.saveError ? '　' + r.saveError : '');
          JR.setStatus($('filesStatus'), msg, r.saveError ? 'error' : 'ok');
          load();
        }).catch(function (err) {
          JR.setStatus($('filesStatus'), '匯入失敗：' + JR.errText(err), 'error');
        });
      });
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
