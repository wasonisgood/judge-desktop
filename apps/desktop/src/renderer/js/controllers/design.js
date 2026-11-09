// 控制器：研究設計引導（issue #11）。對話紀錄在本機；AI 只整理欄位草稿，不會自動儲存或改動條件。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var V = JR.views.design;
  var current = null;
  var busy = false;

  function status(msg, kind) { JR.setStatus($('designStatus'), msg, kind); }
  function fail(err) { status(JR.errText(err), 'error'); }

  function answerText() { return $('designAnswer').value.trim(); }

  var handlers = {
    accept: function (suggestionId) {
      api.design.accept({ id: current, suggestionId: suggestionId }).then(function (view) {
        V.renderWork(view, handlers);
        status('已接受建議，欄位已更新。', 'ok');
      }, fail);
    },
    skip: function (suggestionId) {
      api.design.skip({ id: current, suggestionId: suggestionId }).then(function (view) {
        V.renderWork(view, handlers);
        status('已略過這則建議，條件未改動。');
      }, fail);
    }
  };

  function refreshList() {
    return api.design.list().then(function (items) {
      V.renderSelect(items, current);
      return items;
    });
  }

  function open(id) {
    return api.design.get({ id: id }).then(function (view) {
      current = view.id;
      V.renderWork(view, handlers);
      return refreshList();
    });
  }

  function loadPage() {
    refreshList().then(function (items) {
      if (current) return;
      if (items.length) return open(items[0].id);
      V.showStart(true);
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

  JR.controllers.design = {
    load: loadPage,
    bind: function () {
      var railItem = document.querySelector('[data-page="design"]');
      if (railItem) railItem.addEventListener('click', loadPage);

      $('designSelect').addEventListener('change', function () {
        var id = $('designSelect').value;
        if (!id) { current = null; V.clearWork(); return; }
        open(id).catch(fail);
      });

      $('designNew').addEventListener('click', function () {
        current = null;
        $('designSelect').value = '';
        $('designProblem').value = '';
        V.showStart(true);
        status('');
        $('designProblem').focus();
      });

      $('designStartForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var problem = $('designProblem').value.trim();
        if (!problem) { status('請先輸入問題意識（可以很模糊）。', 'error'); return; }
        api.design.create({ problem: problem }).then(function (view) {
          current = view.id;
          V.renderWork(view, handlers);
          $('designProblem').value = '';
          status('已記下問題意識，請依序回答助理的追問。', 'ok');
          return refreshList();
        }).catch(fail);
      });

      $('designAnswerForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var text = answerText();
        if (!text) { status('請輸入回答。', 'error'); return; }
        if (busy) return;
        busy = true;
        api.design.answer({ id: current, text: text }).then(function (view) {
          $('designAnswer').value = '';
          V.renderWork(view, handlers);
          status('已記錄回答。');
        }, fail).then(function () { busy = false; });
      });

      // AI 整理：只把草稿填入欄位表單，必須按「儲存欄位」才會生效。
      $('designAiFill').addEventListener('click', function () {
        var text = answerText();
        if (!text) { status('請先在回答框輸入想法，再按「AI 整理成欄位」。', 'error'); return; }
        if (busy) return;
        busy = true;
        status('AI 整理中…');
        api.design.aiFill({ text: text }).then(function (r) {
          var n = Object.keys(r.fields || {}).length;
          if (!n) { status('AI 沒有從這段話找到可填入的欄位，請直接在下方欄位填寫。', 'error'); return; }
          V.fillFields(r.fields);
          status('AI 已填入 ' + n + ' 個欄位草稿，請確認後按「儲存欄位」。', 'ok');
        }, fail).then(function () { busy = false; });
      });

      $('designAnswerForm').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) $('designAnswerForm').dispatchEvent(new Event('submit', { cancelable: true }));
      });

      $('designFieldsForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!current) return;
        api.design.setFields({ id: current, fields: V.readFields() }).then(function (view) {
          V.renderWork(view, handlers);
          status('欄位已儲存。', 'ok');
        }, fail);
      });

      $('designRemove').addEventListener('click', function () {
        if (!current) return;
        if (!window.confirm('刪除這筆研究設計的對話紀錄？此操作無法復原。')) return;
        var id = current;
        api.design.remove({ id: id }).then(function () {
          current = null;
          V.clearWork();
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
