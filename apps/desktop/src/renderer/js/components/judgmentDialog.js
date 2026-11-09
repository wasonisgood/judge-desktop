// 元件：覆核「跳至原文」視窗。顯示判決原文，依據所在位置以底色標示並捲動到可見；找不到或取得失敗時明確說明。
// 全部以 textContent 寫入，不解譯 HTML。樣式沿用說明視窗（explain-overlay／explain-box）。
(function (JR) {
  'use strict';

  /**
   * view：主程序 scope:judgmentText 的回傳（ok 時含 title、text、span、message；失敗時含 error）。
   * quote：要定位的依據文字（顯示用）。
   */
  JR.components.judgmentDialog = function (view, quote) {
    var old = document.getElementById('judgmentOverlay');
    if (old) old.parentNode.removeChild(old);

    var overlay = document.createElement('div');
    overlay.id = 'judgmentOverlay';
    overlay.className = 'explain-overlay';

    var box = document.createElement('div');
    box.className = 'explain-box judgment-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    var h = document.createElement('h2');
    h.textContent = (view && view.ok && view.title) ? view.title : '判決原文';
    box.appendChild(h);

    var q = document.createElement('p');
    q.className = 'hint';
    q.textContent = '依據：「' + (quote || '') + '」';
    box.appendChild(q);

    var status = document.createElement('p');
    status.className = 'status';
    box.appendChild(status);

    if (!view || !view.ok) {
      status.classList.add('error');
      status.textContent = (view && view.error) || '無法取得判決全文。';
    } else {
      status.classList.add(view.span ? 'ok' : 'error');
      status.textContent = view.message || '';
      var pre = document.createElement('div');
      pre.className = 'judgment-text';
      pre.setAttribute('tabindex', '0');
      var text = view.text || '';
      if (view.span) {
        var s = view.span.start;
        var e = view.span.end;
        pre.appendChild(document.createTextNode(text.slice(0, s)));
        var mark = document.createElement('mark');
        mark.className = 'judgment-hit';
        mark.textContent = text.slice(s, e);
        pre.appendChild(mark);
        pre.appendChild(document.createTextNode(text.slice(e)));
      } else {
        pre.textContent = text;
      }
      box.appendChild(pre);
      if (view.span) {
        // 捲動到依據所在位置（置中）；需在加入文件後才有效。
        setTimeout(function () {
          var m = pre.querySelector('mark.judgment-hit');
          if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' });
        }, 0);
      }
    }

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
