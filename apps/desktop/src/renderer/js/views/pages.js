// 視圖：把頁面模板掛載到 #pages（需在控制器綁定事件之前執行）。
(function (JR) {
  'use strict';

  // authGate 是覆蓋畫面的登入閘門（不是頁面，但與頁面同樣以模板掛載）。
  var ORDER = ['home', 'list', 'semantic', 'scope', 'brief', 'design', 'files', 'settings', 'authGate'];

  JR.views.mountPages = function () {
    var html = ORDER.map(function (n) { return JR.templates[n + 'Page']; }).join('\n');
    // 設定頁的工作負載身分聯盟引導面板（v3.7.0），以佔位符標示插入位置。
    html = html.replace('@@FED_PANEL@@', function () { return JR.templates.fedPanel; });
    JR.$('pages').innerHTML = html;
  };
})(window.JR);
