// 視圖：第 2、3 步：方案選項卡片與同意頁的事實列。
(function (WZ) {
  'use strict';
  var $ = WZ.$, h = WZ.h, clear = WZ.clear, fact = WZ.fact;

  /** 渲染方案卡片；第一個為預設選項（設定 WZ.state.choice）。 */
  WZ.views.renderOptions = function (options, networkReady) {
    var box = $('optList');
    clear(box);
    WZ.state.choice = null;
    options.forEach(function (o, i) {
      var card = h('label', null, 'wiz-option');
      var input = h('input');
      input.type = 'radio';
      input.name = 'aiChoice';
      input.value = o.id;
      input.checked = i === 0;
      card.appendChild(input);
      var body = h('div', null, 'wiz-option-body');
      var head = h('div', null, 'wiz-option-head');
      head.appendChild(h('span', o.label, 'wiz-option-title'));
      if (o.id === 'recommended') head.appendChild(h('span', '建議', 'wiz-pill pass'));
      body.appendChild(head);
      var p = o.plan;
      var desc = o.id === 'skip'
        ? '不安裝本地 AI，所有 AI 功能使用雲端。'
        : '精讀模型 ' + p.judgmentModel + '；回答模型 ' + (p.chatModel === p.judgmentModel ? '同上' : p.chatModel) + '。約需 ' + p.requiredDiskGB + ' GB 磁碟。';
      body.appendChild(h('div', desc, 'wiz-option-desc'));
      if (o.id !== 'skip') (p.reasons || []).forEach(function (r) { body.appendChild(h('div', '・' + r, 'wiz-option-reason')); });
      card.appendChild(body);
      box.appendChild(card);
      if (i === 0) WZ.state.choice = o.id;
    });
    $('btnToAgree').disabled = !networkReady && options.some(function (o) { return o.id !== 'skip'; });
    $('chooseMsg').textContent = networkReady ? '' : '網路未就緒時只能選擇「不安裝」。';
    $('chooseMsg').className = networkReady ? 'status' : 'status error';
  };

  /** 同意頁：依所選方案列出事實，並設定安裝按鈕文字。 */
  WZ.views.renderAgree = function (opt) {
    var f = $('agreeFacts');
    clear(f);
    fact(f, '方案', opt.label);
    if (opt.id === 'skip') {
      fact(f, '結果', '不安裝，所有 AI 功能使用雲端');
      $('btnInstall').textContent = '確定，不安裝';
    } else {
      fact(f, '精讀模型', opt.plan.judgmentModel);
      fact(f, '回答模型', opt.plan.chatModel);
      fact(f, '所需磁碟', '約 ' + opt.plan.requiredDiskGB + ' GB');
      fact(f, '引擎', '官方 Ollama（zip），以 GitHub 提供的 SHA-256 校驗');
      fact(f, '既有服務', '版本夠新就沿用；太舊不動它，改裝本程式自己的引擎');
      $('btnInstall').textContent = '開始安裝';
    }
  };
})(window.WZ);
