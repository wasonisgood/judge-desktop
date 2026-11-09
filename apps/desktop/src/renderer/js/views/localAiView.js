// 視圖：設定頁的本地模組摘要與更新程式狀態列。
(function (JR) {
  'use strict';
  var $ = JR.$;

  var MODULE_STATUS = {
    'not-installed': '尚未安裝',
    installing: '安裝中',
    ready: '已安裝並啟用',
    failed: '安裝失敗（請開啟精靈修復）',
    disabled: '已選擇不安裝（只用雲端）'
  };
  var UPD_PHASE = { idle: '閒置', checking: '檢查更新中', available: '有新版本', downloading: '下載中', verifying: '驗證中', installing: '安裝中', error: '發生錯誤' };

  JR.views.renderModuleSummary = function (reg) {
    var ai = reg['ai-engine'], cr = reg.crawler;
    var a = $('localAiSummary');
    var c = $('localCrawlSummary');
    a.textContent = 'AI 引擎：' + (MODULE_STATUS[ai.status] || ai.status);
    a.className = 'status' + (ai.status === 'failed' ? ' error' : ai.status === 'ready' ? ' ok' : '');
    c.textContent = '爬取模組：' + (MODULE_STATUS[cr.status] || cr.status);
    c.className = 'status' + (cr.status === 'failed' ? ' error' : cr.status === 'ready' ? ' ok' : '');
  };

  JR.views.renderUpdaterSummary = function (u) {
    var el = document.getElementById('updaterSummary');
    if (!u.available) { el.textContent = '更新程式：此版本未包含更新程式。'; el.className = 'status'; return; }
    var parts = ['更新程式：' + (u.running ? '執行中（' + (UPD_PHASE[u.phase] || u.phase) + '）' : (UPD_PHASE[u.phase] || u.phase))];
    if (u.lastCheckUtc) parts.push('上次檢查：' + new Date(u.lastCheckUtc).toLocaleString());
    if (u.latestVersion) parts.push('最新版本：' + u.latestVersion);
    if (u.lastError) parts.push('錯誤：' + u.lastError);
    el.textContent = parts.join('　');
    el.className = 'status' + (u.phase === 'error' ? ' error' : '');
  };
})(window.JR);
