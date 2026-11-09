// 控制器：設定頁（AI 服務、金鑰、快取、檢查更新）。金鑰只以加密形式保存，畫面只顯示「是否已設定」。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;

  function load() {
    return api.settings.get().then(JR.views.fillSettings);
  }

  JR.controllers.settings = {
    load: load,
    bind: function () {
      $('setAuthMode').addEventListener('change', JR.views.applyAuthMode);
      $('setProvider').addEventListener('change', JR.views.fillProviderDefaults);

      $('settingsForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var patch = JR.views.readSettingsForm();
        var key = $('setKey').value.trim();
        if (key) patch.apiKey = key;
        try {
          await api.settings.set(patch);
          $('setKey').value = '';
          JR.setStatus($('setStatus'), '已儲存。', 'ok');
          load();
        } catch (err) {
          JR.setStatus($('setStatus'), '儲存失敗：' + JR.errText(err), 'error');
        }
      });
      $('setTest').addEventListener('click', async function () {
        JR.setStatus($('setStatus'), '測試中…');
        try {
          var r = await api.settings.test();
          JR.setStatus($('setStatus'), '連線成功，回覆：' + r.reply, 'ok');
        } catch (err) {
          JR.setStatus($('setStatus'), '連線失敗：' + JR.errText(err), 'error');
        }
      });
      $('setClear').addEventListener('click', async function () {
        await api.settings.set({ clearKey: true });
        JR.setStatus($('setStatus'), '已清除金鑰。', 'ok');
        load();
      });
      $('cacheClear').addEventListener('click', async function () {
        await api.cache.clear();
        JR.components.notice('本機快取已清除。');
      });
      $('openUpdater').addEventListener('click', async function () {
        var ok = await api.update.openUpdater();
        JR.components.notice(ok ? '已開啟更新程式。' : '此為開發版本，無法檢查更新。');
      });
      $('briefFieldAdd').addEventListener('click', function () {
        $('briefFieldList').appendChild(JR.components.briefFieldRow({ name: '', description: '', enabled: true }));
        $('briefFieldList').lastChild.querySelector('.brief-field-name').focus();
      });
    }
  };
})(window.JR);
