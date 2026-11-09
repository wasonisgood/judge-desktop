// 視圖：模組與更新頁：模組卡片（狀態與事實）、更新計畫列表與套用結果。
(function (WZ) {
  'use strict';
  var $ = WZ.$, h = WZ.h, clear = WZ.clear, fact = WZ.fact, setPill = WZ.setPill;

  WZ.views.renderModules = function (reg) {
    var ai = reg['ai-engine'];
    var cr = reg.crawler;
    setPill($('modAiPill'), WZ.MOD_STATUS[ai.status][0], WZ.MOD_STATUS[ai.status][1]);
    setPill($('modCrPill'), WZ.MOD_STATUS[cr.status][0], WZ.MOD_STATUS[cr.status][1]);
    var fa = $('modAiFacts'); clear(fa);
    fact(fa, '已安裝版本', ai.installedVersion);
    fact(fa, '最近錯誤', ai.lastError ? ai.lastError.split('｜')[0] : '無');
    var fc = $('modCrFacts'); clear(fc);
    fact(fc, '已安裝版本', cr.installedVersion);
    fact(fc, '最近錯誤', cr.lastError || '無');
  };

  WZ.views.setUpdMsg = function (text, kind) {
    $('updMsg').textContent = text;
    $('updMsg').className = 'status' + (kind ? ' ' + kind : '');
  };

  /** 檢查更新的結果：計畫列表與摘要；回傳是否有可套用的更新。 */
  WZ.views.renderUpdatePlans = function (r) {
    var rows = $('updRows');
    clear(rows);
    if (!r.ok) {
      $('updSummary').textContent = '無法檢查更新：' + r.error;
      $('updSummary').className = 'wiz-summary error';
      return false;
    }
    r.plans.forEach(function (p) {
      var li = h('li', null, 'wiz-row');
      var body = h('div', null, 'wiz-row-body');
      body.appendChild(h('div', WZ.MOD_NAMES[p.moduleId] || p.moduleId, 'wiz-row-title'));
      var detail = p.upToDate ? '已是最新版本 ' + p.toVersion
        : p.requiresAppUpdate ? '版本 ' + p.toVersion + ' 需要更新應用程式'
        : (p.fromVersion || '未安裝') + ' → ' + p.toVersion + '；需下載 ' + p.download.length + ' 個檔案，沿用 ' + p.reuse.length + ' 個';
      body.appendChild(h('div', detail, 'wiz-row-detail'));
      li.appendChild(body);
      var tone = p.upToDate ? 'pass' : p.requiresAppUpdate ? 'fail' : 'warn';
      li.appendChild(h('span', p.upToDate ? '最新' : p.requiresAppUpdate ? '需升級程式' : '有更新', 'wiz-pill ' + tone));
      rows.appendChild(li);
    });
    var anyChange = r.plans.some(function (p) { return !p.upToDate && !p.requiresAppUpdate; });
    $('updSummary').textContent = anyChange ? '有可套用的更新。' : '目前沒有可套用的更新。';
    $('updSummary').className = 'wiz-summary ' + (anyChange ? '' : 'ok');
    return anyChange;
  };

  WZ.views.renderApplyResults = function (r) {
    var rows = $('updRows');
    clear(rows);
    r.results.forEach(function (x) {
      var li = h('li', null, 'wiz-row ' + (x.ok ? 'pass' : 'fail'));
      var body = h('div', null, 'wiz-row-body');
      body.appendChild(h('div', WZ.MOD_NAMES[x.module] || x.module, 'wiz-row-title'));
      body.appendChild(h('div', x.message, 'wiz-row-detail'));
      li.appendChild(body);
      li.appendChild(h('span', x.ok ? '完成' : '失敗', 'wiz-pill ' + (x.ok ? 'pass' : 'fail')));
      rows.appendChild(li);
    });
    var allOk = r.results.every(function (x) { return x.ok; });
    $('updSummary').textContent = allOk ? '更新已套用。' : '部分模組沒有更新成功，已保留原本的版本。';
    $('updSummary').className = 'wiz-summary ' + (allOk ? 'ok' : 'error');
  };
})(window.WZ);
