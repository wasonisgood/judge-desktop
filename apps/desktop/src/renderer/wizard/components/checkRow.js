// 元件：排除問題的一列（標題、說明、狀態標籤，與可選的修復按鈕）。
(function (WZ) {
  'use strict';
  var h = WZ.h;

  /** onFix(action, btn) 由控制器提供；修復中（安裝進行中）按鈕停用。 */
  WZ.components.checkRow = function (c, onFix) {
    var li = h('li', null, 'wiz-row ' + c.status);
    var body = h('div', null, 'wiz-row-body');
    body.appendChild(h('div', c.title, 'wiz-row-title'));
    body.appendChild(h('div', c.detail, 'wiz-row-detail'));
    li.appendChild(body);
    var side = h('div', null, 'wiz-row-side');
    side.appendChild(h('span', WZ.TONE[c.status], 'wiz-pill ' + (c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'fail' : 'warn')));
    if (c.fix && WZ.FIX_NAMES[c.fix] && c.fix !== 'free-disk-space' && c.fix !== 'check-network-vpn') {
      var b = h('button', WZ.FIX_NAMES[c.fix], 'btn');
      b.type = 'button';
      b.disabled = WZ.state.installStatus === 'running';
      b.addEventListener('click', function () { onFix(c.fix, b); });
      side.appendChild(b);
    }
    li.appendChild(side);
    return li;
  };
})(window.WZ);
