// 視圖：第 5 步「完成」：註冊結果與事實列。
(function (WZ) {
  'use strict';
  var $ = WZ.$, clear = WZ.clear, fact = WZ.fact;

  WZ.views.renderDone = function (registered) {
    var state = WZ.state;
    $('doneTitle').textContent = registered ? '已完成註冊' : '已記錄為不安裝';
    $('doneLead').textContent = registered
      ? '精讀與範圍整理會優先使用本地模型；本地模型失敗時自動改用雲端。'
      : '所有 AI 功能將使用雲端。之後仍可在這裡重新安裝。';
    var f = $('doneFacts');
    clear(f);
    if (registered && state.choice && state.plan) {
      var opt = state.plan.options.find(function (o) { return o.id === state.choice; });
      if (opt && opt.plan) {
        fact(f, '方案', opt.label);
        fact(f, '精讀模型', opt.plan.judgmentModel);
        fact(f, '回答模型', opt.plan.chatModel);
      }
      fact(f, '模組版本', state.installedVersion);
    }
    fact(f, '狀態', registered ? '已註冊並啟用' : '未安裝');
  };
})(window.WZ);
