// 控制器：研究設計（AI 多輪對話）。對話紀錄存在本機；AI 可呼叫寫入欄位、試搜尋、帶入範圍整理等工具。
// 使用者仍可直接在欄位表單修改並儲存。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var V = JR.views.design;
  var PAGE = 'design';
  var current = null;

  function status(msg, kind) { JR.setStatus($('designStatus'), msg, kind); }
  function fail(err) { status(JR.errText(err), 'error'); }

  function refreshList() {
    return api.design.list().then(function (items) {
      V.renderSelect(items, current);
      return items;
    });
  }

  function open(id) {
    return api.design.get({ id: id }).then(function (view) {
      current = view.id;
      V.renderWork(view);
      return refreshList();
    });
  }

  function loadPage() {
    refreshList().then(function (items) {
      if (current) return;
      if (items.length) return open(items[0].id);
      V.showEmpty();
    }).catch(fail);
  }

  function handOffToScope() {
    api.design.get({ id: current }).then(function (view) {
      var o = view.scopeOptions;
      if (!o) { status('尚未填寫法規，無法帶入範圍整理。', 'error'); return; }
      // 範圍整理頁的表單欄位：法規（每行一部）、起迄年。案件類型與審級不會自動篩選，需在列表中人工篩選。
      $('scopeLines').value = o.statute;
      $('scopeFrom').value = o.yearFrom !== undefined ? String(o.yearFrom) : '';
      $('scopeTo').value = o.yearTo !== undefined ? String(o.yearTo) : '';
      JR.setStatus($('scopeStatus'), '已從研究設計帶入法規與期間。', 'ok');
      JR.nav.showPage('scope');
    }, fail);
  }

  function send() {
    var text = $('designAnswer').value.trim();
    if (!text) { status('請輸入內容再送出。', 'error'); return; }
    if (JR.jobs.isBusy(PAGE)) { status('助理正在回覆，請等候或按「取消」。', 'error'); return; }
    var runId = JR.jobs.start(PAGE, 'designCancel');
    $('designAnswer').value = '';
    V.appendPending(text);
    status('助理回覆中…');
    api.design.chat({ runId: runId, id: current || undefined, text: text }).then(function (r) {
      current = r.view.id;
      V.renderWork(r.view);
      status(r.actions.length ? '已執行：' + r.actions.join('；') : '', r.actions.length ? 'ok' : '');
      if (r.navigate === 'scope') handOffToScope();
      return refreshList();
    }).catch(function (err) {
      // 失敗或取消：把輸入還原，畫面回到已保存的紀錄。
      $('designAnswer').value = text;
      if (current) return open(current).then(function () { fail(err); }, fail);
      V.showEmpty();
      fail(err);
    }).finally(function () {
      JR.jobs.finish(PAGE);
    });
  }

  JR.controllers.design = {
    load: loadPage,
    bind: function () {
      var railItem = document.querySelector('[data-page="design"]');
      if (railItem) railItem.addEventListener('click', loadPage);

      $('designSelect').addEventListener('change', function () {
        var id = $('designSelect').value;
        if (!id) { current = null; V.showEmpty(); return; }
        open(id).catch(fail);
      });

      $('designNew').addEventListener('click', function () {
        current = null;
        $('designSelect').value = '';
        $('designAnswer').value = '';
        V.showEmpty();
        status('');
        $('designAnswer').focus();
        refreshList().catch(fail);
      });

      $('designAnswerForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        send();
      });

      $('designAnswer').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          send();
        }
      });

      $('designFieldsForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!current) { status('請先開始一段對話，再儲存欄位。', 'error'); return; }
        api.design.setFields({ id: current, fields: V.readFields() }).then(function (view) {
          V.renderWork(view);
          status('欄位已儲存。', 'ok');
        }, fail);
      });

      $('designRemove').addEventListener('click', function () {
        if (!current) return;
        if (!window.confirm('刪除這筆研究設計的對話紀錄？此操作無法復原。')) return;
        var id = current;
        api.design.remove({ id: id }).then(function () {
          current = null;
          V.showEmpty();
          status('已刪除。');
          return refreshList();
        }).catch(fail);
      });

      $('designExportDocx').addEventListener('click', function () { exportAs('docx'); });
      $('designExportTxt').addEventListener('click', function () { exportAs('txt'); });
      function exportAs(format) {
        if (!current) return;
        api.design.export({ id: current, format: format }).then(function (r) {
          if (!r.canceled) status('已匯出：' + r.filePath, 'ok');
        }, fail);
      }

      $('designToScope').addEventListener('click', handOffToScope);
    }
  };
})(window.JR);
