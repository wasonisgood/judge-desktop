// 元件：助理面板的進度卡。把範圍整理或精讀頁面上的狀態（文字與進度條）同步到面板，不必切換頁面。
(function (JR) {
  'use strict';

  var progressWatchers = [];

  JR.components.progressCard = function (label, statusId, barSelector) {
    var $ = JR.$, el = JR.el;
    var card = el('div', 'assist-progress');
    var head = el('div', 'assist-progress-head');
    head.appendChild(el('strong', '', label));
    var clock = el('span', 'assist-progress-clock', '0 秒');
    head.appendChild(clock);
    card.appendChild(head);
    var text = el('p', 'assist-progress-text', '準備中…');
    card.appendChild(text);
    var track = el('div', 'progress assist-progress-track');
    var bar = el('div', 'bar');
    track.appendChild(bar);
    card.appendChild(track);
    $('assistLog').appendChild(card);
    $('assistLog').scrollTop = $('assistLog').scrollHeight;

    var started = Date.now();
    var timer = setInterval(function () {
      clock.textContent = Math.round((Date.now() - started) / 1000) + ' 秒';
    }, 1000);
    var src = $(statusId);
    var barSrc = document.querySelector(barSelector);
    function sync() {
      var t = src.textContent || '';
      text.textContent = t || '準備中…';
      if (barSrc) bar.style.width = barSrc.style.width || '0%';
      if (/完成|失敗|已完成|整理失敗|讀取失敗/.test(t)) {
        var failed = /失敗/.test(t);
        card.classList.add(failed ? 'error' : 'done');
        var h = card.querySelector('strong');
        if (h) h.textContent = label.replace(/進行中$/, failed ? '失敗' : '完成');
        clearInterval(timer);
        observer.disconnect();
        clock.textContent = '共 ' + Math.round((Date.now() - started) / 1000) + ' 秒';
        $('assistLog').scrollTop = $('assistLog').scrollHeight;
      }
    }
    var observer = new MutationObserver(sync);
    observer.observe(src, { childList: true, characterData: true, subtree: true });
    if (barSrc) observer.observe(barSrc, { attributes: true, attributeFilter: ['style'] });
    // 不做初次同步：頁面上可能還是上一次的「完成」狀態，等執行開始後的狀態變化才同步。
    progressWatchers.push(observer);
    return card;
  };
})(window.JR);
