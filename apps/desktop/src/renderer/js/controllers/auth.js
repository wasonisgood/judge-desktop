// 控制器：登入閘門（啟動時檢查狀態、開始登入、取消、登出）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;

  /** 啟動時檢查：未登入則顯示閘門（覆蓋主畫面）。 */
  function checkOnStart() {
    return api.auth.status().then(function (s) {
      if (s.signedIn) JR.views.hideAuthGate();
      else JR.views.showAuthGate(s.message);
    }).catch(function (err) {
      JR.views.showAuthGate('無法確認登入狀態：' + JR.errText(err));
    });
  }

  function startLogin() {
    JR.views.setAuthBusy(true);
    JR.views.setAuthMessage('已開啟瀏覽器，請在瀏覽器中完成登入。', '');
    api.auth.start().then(function (s) {
      if (s.signedIn) {
        JR.views.hideAuthGate();
        JR.components.notice('已登入。');
      } else {
        JR.views.showAuthGate(s.message);
      }
    }).catch(function (err) {
      JR.views.showAuthGate(JR.errText(err));
    });
  }

  JR.controllers.auth = {
    checkOnStart: checkOnStart,
    bind: function () {
      $('authStart').addEventListener('click', startLogin);
      $('authCancel').addEventListener('click', function () {
        api.auth.cancel().then(function (s) { JR.views.showAuthGate(s.message); }).catch(function (err) { JR.views.showAuthGate('取消登入失敗：' + JR.errText(err)); });
      });
      $('authSignOut').addEventListener('click', function () {
        api.auth.signOut().then(function () {
          JR.views.showAuthGate('已登出。');
        });
      });
    }
  };
})(window.JR);
