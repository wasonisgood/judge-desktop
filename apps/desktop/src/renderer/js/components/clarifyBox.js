// 元件：語意不清時的選項區（issue #4 第 3 點）。最後一項 id 為 manual 時，會改為文字輸入框讓使用者自行更正。
(function (JR) {
  'use strict';
  /** opts: { question, options: [{id,label,description}], onPick(option), onManual(text) } */
  JR.components.clarifyBox = function (container, opts) {
    container.innerHTML = '';
    container.hidden = false;
    var q = document.createElement('p');
    q.textContent = opts.question;
    container.appendChild(q);
    opts.options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = o.label;
      b.title = o.description || '';
      b.addEventListener('click', function () {
        if (o.id === 'manual') showManual(); else opts.onPick(o);
      });
      container.appendChild(b);
    });
    function showManual() {
      container.innerHTML = '';
      var label = document.createElement('label');
      label.className = 'field';
      var span = document.createElement('span');
      span.textContent = '請輸入更正後的內容';
      var input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      label.appendChild(span);
      label.appendChild(input);
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn primary';
      go.textContent = '以此重試';
      go.addEventListener('click', function () {
        var text = input.value.trim();
        if (text) opts.onManual(text);
      });
      container.appendChild(label);
      container.appendChild(go);
      input.focus();
    }
  };
  JR.components.clarifyHide = function (container) {
    container.innerHTML = '';
    container.hidden = true;
  };
})(window.JR);
