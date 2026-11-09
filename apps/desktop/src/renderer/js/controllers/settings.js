// 控制器：設定頁。AI 服務以「儲存」送出；本地模型與預設管轄區的開關會立即保存。金鑰只以加密形式保存。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var jurisdictions = [];
  var defaultJurisdiction = null;

  function renderAuthSummary() {
    return api.auth.status().then(function (s) {
      $('authSummary').textContent = s.signedIn
        ? '已登入' + (s.expiresAt ? '（權杖到 ' + new Date(s.expiresAt).toLocaleDateString('zh-TW') + '）' : '')
        : (s.message || '尚未登入');
    }).catch(function () { $('authSummary').textContent = '無法讀取登入狀態'; });
  }

  // 覆核門檻的無效標記（畫面沒有編輯欄，保留設定中的值，保存時一併送出）。
  var reviewMarkers = null;

  function saveReviewPolicy() {
    var policy = {
      minEvidence: Number($('setReviewMinEvidence').value),
      maxDroppedEvidence: Number($('setReviewMaxDropped').value),
      unknownMarkers: reviewMarkers || undefined
    };
    return api.settings.set({ scopeReviewPolicy: policy }).then(function () {
      JR.components.notice('已保存覆核門檻（下次整理生效）。');
    }).catch(function (err) {
      JR.components.notice('覆核門檻沒有保存：' + JR.errText(err));
    });
  }

  function load() {
    return Promise.all([api.settings.get(), api.jurisdictions.list()]).then(function (res) {
      var s = res[0];
      reviewMarkers = s.scopeReviewPolicy && s.scopeReviewPolicy.unknownMarkers ? s.scopeReviewPolicy.unknownMarkers : null;
      jurisdictions = res[1] || [];
      defaultJurisdiction = s.defaultJurisdiction;
      JR.views.fillSettings(s);
      JR.views.fillJurisdictions(jurisdictions, defaultJurisdiction);
      renderAuthSummary();
    });
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

      $('setReviewMinEvidence').addEventListener('change', saveReviewPolicy);
      $('setReviewMaxDropped').addEventListener('change', saveReviewPolicy);

      $('setLocalAi').addEventListener('change', async function () {
        var on = $('setLocalAi').checked;
        try {
          await api.settings.set({ localAiEnabled: on });
          JR.components.notice(on ? '已開啟本地模型（已安裝時優先使用）。' : '已關閉本地模型，所有 AI 功能改用雲端。');
        } catch (err) {
          $('setLocalAi').checked = !on;
          JR.components.notice('設定沒有保存：' + JR.errText(err));
        }
      });

      $('setJurisdiction').addEventListener('change', async function () {
        var id = $('setJurisdiction').value;
        try {
          await api.settings.set({ defaultJurisdiction: id });
          defaultJurisdiction = id;
          JR.views.fillJurisdictions(jurisdictions, id);
          JR.components.notice('已將預設管轄區設為「' + (jurisdictions.filter(function (j) { return j.id === id; })[0] || { name: id }).name + '」。');
        } catch (err) {
          JR.components.notice('設定沒有保存：' + JR.errText(err));
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
        try {
          await api.settings.set({ clearKey: true });
          JR.setStatus($('setStatus'), '已清除金鑰。', 'ok');
          load();
        } catch (err) {
          JR.setStatus($('setStatus'), '清除金鑰失敗：' + JR.errText(err), 'error');
        }
      });
      $('cacheClear').addEventListener('click', async function () {
        try {
          await api.cache.clear();
          JR.components.notice('本機快取已清除。');
        } catch (err) {
          JR.components.notice('清除快取失敗：' + JR.errText(err));
        }
      });
      $('openUpdater').addEventListener('click', async function () {
        var ok = await api.update.openUpdater();
        // 應用程式內更新只存在於 Windows 安裝版；開發版與 macOS、Linux 版請到 GitHub Releases 下載。
        JR.components.notice(ok ? '已開啟更新程式。' : '此版本無法在應用程式內檢查更新（開發版，或 macOS／Linux 版）。請到 GitHub Releases 下載最新版。');
      });
      $('openCrawl').addEventListener('click', function () { api.localAi.openWizard({ view: 'diag' }); });
      $('briefFieldAdd').addEventListener('click', function () {
        $('briefFieldList').appendChild(JR.components.briefFieldRow({ name: '', description: '', enabled: true }));
        $('briefFieldList').lastChild.querySelector('.brief-field-name').focus();
      });
    }
  };
})(window.JR);
