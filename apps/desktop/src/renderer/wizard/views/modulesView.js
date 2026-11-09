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
})(window.WZ);
