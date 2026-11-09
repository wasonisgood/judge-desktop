// 元件：處理流程說明視窗（issue #4 第 7 點）。內容由主程序的流程紀錄產生，全部以 textContent 寫入，不解譯 HTML。
(function (JR) {
  'use strict';
  /** explanation: { title: string, paragraphs: string[] } */
  JR.components.explainDialog = function (explanation) {
    var old = document.getElementById('explainOverlay');
    if (old) old.parentNode.removeChild(old);

    var overlay = document.createElement('div');
    overlay.id = 'explainOverlay';
    overlay.className = 'explain-overlay';

    var box = document.createElement('div');
    box.className = 'explain-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    var h = document.createElement('h2');
    h.textContent = (explanation && explanation.title) || '處理流程說明';
    box.appendChild(h);

    var list = document.createElement('ol');
    list.className = 'explain-steps';
    var paragraphs = (explanation && explanation.paragraphs) || [];
    if (paragraphs.length === 0) {
      var empty = document.createElement('li');
      empty.textContent = '沒有可說明的處理步驟。';
      list.appendChild(empty);
    }
    paragraphs.forEach(function (text) {
      var li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    box.appendChild(list);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn primary';
    close.textContent = '關閉';
    close.addEventListener('click', closeIt);
    box.appendChild(close);

    overlay.appendChild(box);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeIt(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    close.focus();

    function onKey(ev) { if (ev.key === 'Escape') closeIt(); }
    function closeIt() {
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  };
})(window.JR);
