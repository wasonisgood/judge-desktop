// 共用 DOM 工具：取得元素、建立元素、狀態列文字、錯誤訊息整理、時間格式。
(function (JR) {
  'use strict';

  JR.$ = function (id) { return document.getElementById(id); };

  JR.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };

  JR.setStatus = function (el, msg, kind) {
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  };

  JR.errText = function (err) {
    var m = err && err.message ? err.message : String(err);
    return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  };

  JR.fmtTime = function (iso) {
    try { return new Date(iso).toLocaleString('zh-TW', { hour12: false }); } catch (e) { return iso; }
  };

  JR.KIND_LABEL = { list: '判決列表', scope: '範圍整理', brief: '單一判決' };
})(window.JR);
