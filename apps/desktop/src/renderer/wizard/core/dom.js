// 共用 DOM 工具（所有動態文字都用 textContent 建立，不使用 innerHTML）。
(function (WZ) {
  'use strict';

  WZ.$ = function (id) { return document.getElementById(id); };

  WZ.h = function (tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };

  WZ.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); };

  WZ.fact = function (dl, label, value) {
    dl.appendChild(WZ.h('dt', label));
    dl.appendChild(WZ.h('dd', value === null || value === undefined || value === '' ? '—' : String(value)));
  };

  WZ.setPill = function (el, label, tone) {
    el.textContent = label;
    el.className = 'wiz-pill ' + (tone || '');
  };

  /** 顯卡說明：Ollama 只會用 NVIDIA／AMD 獨立顯卡加速；其他顯卡（含 Adreno 等集成顯卡）以 CPU 執行模型。 */
  WZ.gpuText = function (hw) {
    if (hw.gpuVendor === 'none') return '未偵測到顯卡資訊';
    var name = hw.gpuName || '（名稱未知）';
    if (hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd') return name + '；獨立顯存 ' + hw.vramGB + ' GB，可用於加速';
    return name + (hw.gpuMemoryShared ? '（共用系統記憶體）' : '') + '；本程式的 Ollama 不會用此顯卡加速，模型以 CPU 執行';
  };

  WZ.errMsg = function (e) { return e && e.message ? e.message : e; };
})(window.WZ);
