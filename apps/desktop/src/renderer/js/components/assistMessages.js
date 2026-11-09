// 元件：助理面板的訊息泡泡與待確認卡片。
(function (JR) {
  'use strict';

  function scrollLog() {
    var log = JR.$('assistLog');
    log.scrollTop = log.scrollHeight;
  }

  JR.components.addMsg = function (role, text) {
    var el = JR.el;
    var m = el('div', 'assist-msg ' + role);
    m.appendChild(el('div', 'assist-who', role === 'user' ? '您' : '助理'));
    m.appendChild(el('div', 'assist-text', text));
    JR.$('assistLog').appendChild(m);
    scrollLog();
    return m;
  };

  /** 待確認卡片：同意後呼叫 onRun(p)；略過則只標示。 */
  JR.components.addPending = function (p, onRun) {
    var el = JR.el;
    var card = el('div', 'assist-confirm');
    card.appendChild(el('p', '', '待確認：' + p.label));
    card.appendChild(el('p', 'hint', '這個操作會呼叫 AI 或改動資料，需要您同意才會執行。'));
    var row = el('div', 'actions');
    var ok = el('button', 'btn small primary', '同意執行');
    ok.type = 'button';
    var no = el('button', 'btn small', '略過');
    no.type = 'button';
    ok.addEventListener('click', function () {
      ok.disabled = true; no.disabled = true;
      card.appendChild(el('p', 'hint', '已同意，開始執行。'));
      onRun(p);
    });
    no.addEventListener('click', function () {
      ok.disabled = true; no.disabled = true;
      card.appendChild(el('p', 'hint', '已略過。'));
    });
    row.appendChild(ok);
    row.appendChild(no);
    card.appendChild(row);
    JR.$('assistLog').appendChild(card);
    scrollLog();
  };
})(window.JR);
