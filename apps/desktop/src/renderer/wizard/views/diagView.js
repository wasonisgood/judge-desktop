// 視圖：排除問題頁：摘要、分組檢查列與修復按鈕。
(function (WZ) {
  'use strict';
  var $ = WZ.$, h = WZ.h, clear = WZ.clear;

  WZ.views.setDiagChecking = function () {
    $('diagSummary').textContent = '檢查中…';
    $('diagSummary').className = 'wiz-summary';
  };

  WZ.views.setDiagError = function (e) {
    $('diagSummary').textContent = '檢查失敗：' + WZ.errMsg(e);
    $('diagSummary').className = 'wiz-summary error';
  };

  /** 依 fixAction 執行修復的回呼由控制器提供。 */
  WZ.views.renderDiagnosis = function (s, onFix) {
    var sum = $('diagSummary');
    var counts = { pass: 0, warn: 0, fail: 0 };
    s.checks.forEach(function (c) { counts[c.status]++; });
    clear(sum);
    var msg = s.overall === 'pass' ? '一切正常' : s.overall === 'warn' ? '可以使用，但有 ' + counts.warn + ' 項需要注意' : '有 ' + counts.fail + ' 項失敗，請依說明修復';
    sum.className = 'wiz-summary ' + (s.overall === 'pass' ? 'ok' : s.overall === 'fail' ? 'error' : '');
    sum.appendChild(h('span', WZ.TONE[s.overall], 'wiz-pill ' + (s.overall === 'pass' ? 'pass' : s.overall === 'fail' ? 'fail' : 'warn')));
    sum.appendChild(h('span', msg, 'wiz-summary-text'));
    sum.appendChild(h('span', '通過 ' + counts.pass + '　警告 ' + counts.warn + '　失敗 ' + counts.fail, 'wiz-summary-count'));

    var box = $('diagGroups');
    clear(box);
    var byId = {};
    s.checks.forEach(function (c) { byId[c.id] = c; });
    var used = {};
    WZ.GROUPS.forEach(function (g) {
      var items = g[1].map(function (id) { used[id] = true; return byId[id]; }).filter(Boolean);
      if (!items.length) return;
      var sec = h('section', null, 'wiz-group');
      sec.appendChild(h('h2', g[0], 'wiz-h2'));
      var ul = h('ul', null, 'wiz-rows');
      items.forEach(function (c) { ul.appendChild(WZ.components.checkRow(c, onFix)); });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
    var rest = s.checks.filter(function (c) { return !used[c.id]; });
    if (rest.length) {
      var sec2 = h('section', null, 'wiz-group');
      sec2.appendChild(h('h2', '其他', 'wiz-h2'));
      var ul2 = h('ul', null, 'wiz-rows');
      rest.forEach(function (c) { ul2.appendChild(WZ.components.checkRow(c, onFix)); });
      sec2.appendChild(ul2);
      box.appendChild(sec2);
    }
  };

  WZ.views.setDiagMsg = function (text, kind) {
    $('diagMsg').textContent = text;
    $('diagMsg').className = 'status' + (kind ? ' ' + kind : '');
  };
})(window.WZ);
