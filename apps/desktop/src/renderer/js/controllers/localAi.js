// 控制器：設定頁的本地模組摘要與更新程式狀態。只顯示狀態；安裝一律在獨立的精靈視窗進行。
(function (JR) {
  'use strict';
  var $ = JR.$;

  function refresh() {
    window.api.localAi.modules().then(JR.views.renderModuleSummary).catch(function (err) {
      JR.components.notice('讀取本地 AI 狀態失敗：' + JR.errText(err));
    });
  }

  // 爭點知識庫狀態（設定頁）：只顯示安裝狀態；按鈕觸發下載與驗證。
  function renderKnowledge(st) {
    var el = $('knowledgeSummary');
    var text;
    if (st.installing) text = '下載與驗證中…';
    else if (st.installed) text = '已安裝 v' + st.version + '，共 ' + st.issueCount + ' 個爭點';
    else text = '尚未安裝（搜尋與判決摘要照常進行，但不含爭點內容）';
    if (st.lastError) text += '　上次更新失敗：' + st.lastError;
    el.textContent = text;
    el.className = 'set-desc' + (st.lastError ? ' error' : st.installed ? ' ok' : '');
    $('knowledgeInstall').disabled = !!st.installing;
  }

  function refreshKnowledge() {
    if (!window.api || !window.api.knowledge) return;
    window.api.knowledge.status().then(renderKnowledge).catch(function () { /* 讀取失敗時保留上一次的內容 */ });
  }

  function refreshUpdater() {
    window.api.updaterStatus().then(JR.views.renderUpdaterSummary).catch(function () { /* 讀取失敗時保留上一次的內容 */ });
  }

  JR.controllers.localAi = {
    bind: function () {
      if (!window.api || !window.api.localAi) return;
      $('openWizard').addEventListener('click', function () { window.api.localAi.openWizard(); });
      $('openDiag').addEventListener('click', function () { window.api.localAi.openWizard({ view: 'diag' }); });
      // 更新程式狀態：每 3 秒讀取一次（更新程式執行中或閒置都會即時反映）。
      refreshUpdater();
      setInterval(refreshUpdater, 3000);
      window.api.localAi.onChanged(refresh);
      refresh();
      if (window.api.knowledge) {
        $('knowledgeInstall').addEventListener('click', function () {
          $('knowledgeInstall').disabled = true;
          window.api.knowledge.install().then(function (st) {
            renderKnowledge(st);
            JR.components.notice(st.upToDate ? '爭點知識庫已是最新版本。' : '爭點知識庫已更新至 v' + st.version + '。');
          }).catch(function (err) {
            JR.components.notice('爭點知識庫更新失敗：' + JR.errText(err));
            refreshKnowledge();
          });
        });
        refreshKnowledge();
      }
    }
  };
})(window.JR);
