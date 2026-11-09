// 元件：頁面頂部的短暫通知（6 秒後自動隱藏）。
(function (JR) {
  'use strict';
  JR.components.notice = function (msg) {
    var n = JR.$('notice');
    n.textContent = msg;
    n.hidden = false;
    setTimeout(function () { n.hidden = true; }, 6000);
  };
})(window.JR);
