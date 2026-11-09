// 視圖：把頁面模板掛載到 #pages（需在控制器綁定事件之前執行）。
(function (JR) {
  'use strict';

  // authGate 是覆蓋畫面的登入閘門（不是頁面，但與頁面同樣以模板掛載）。
  var ORDER = ['home', 'list', 'scope', 'brief', 'files', 'settings', 'authGate'];

  JR.views.mountPages = function () {
    var html = ORDER.map(function (n) { return JR.templates[n + 'Page']; }).join('\n');
    // 設定頁引用「身分聯合步驟說明」元件，以佔位符標示插入位置。
    html = html.replace('@@WIF_GUIDE@@', function () { return JR.templates.wifGuide; });
    JR.$('pages').innerHTML = html;
  };
})(window.JR);
