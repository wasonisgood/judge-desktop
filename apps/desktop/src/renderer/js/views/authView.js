// 視圖：登入閘門的顯示與狀態文字。
(function (JR) {
  'use strict';
  var $ = JR.$;

  JR.views.showAuthGate = function (message) {
    $('authGate').hidden = false;
    JR.views.setAuthBusy(false);
    JR.views.setAuthMessage(message || '', message ? 'error' : '');
  };

  JR.views.hideAuthGate = function () {
    $('authGate').hidden = true;
  };

  JR.views.setAuthBusy = function (busy) {
    $('authStart').disabled = busy;
    $('authCancel').hidden = !busy;
    $('authStart').textContent = busy ? '等待瀏覽器完成登入…' : '開啟瀏覽器登入';
  };

  JR.views.setAuthMessage = function (text, kind) {
    JR.setStatus($('authStatus'), text, kind);
  };
})(window.JR);
