// 視圖：第 1 步「檢查電腦」的結果（事實列與網路連線列表）。
(function (WZ) {
  'use strict';
  var $ = WZ.$, h = WZ.h, clear = WZ.clear, fact = WZ.fact;

  WZ.views.renderCheckResult = function (r) {
    var hw = r.hardware;
    var f = $('checkFacts');
    clear(f);
    fact(f, '處理器架構', r.nativeArch === 'arm64' ? 'ARM64' : r.nativeArch === 'x64' ? 'x64' : r.nativeArch);
    fact(f, '記憶體', hw.ramGB + ' GB');
    fact(f, '可用磁碟', hw.freeDiskGB + ' GB');
    fact(f, '顯卡', WZ.gpuText(hw));
    fact(f, '分級規則', r.rulesSource === 'module' ? '模組更新版' : '內建版');
    var net = $('checkNet');
    clear(net);
    r.network.results.forEach(function (x) {
      var li = h('li', null, 'wiz-row');
      var body = h('div', null, 'wiz-row-body');
      body.appendChild(h('div', x.name, 'wiz-row-title'));
      body.appendChild(h('div', x.ok ? '可以連線（' + x.latencyMs + ' ms）' : (x.error || '無法連線'), 'wiz-row-detail'));
      li.appendChild(body);
      li.appendChild(h('span', x.ok ? '通過' : '失敗', 'wiz-pill ' + (x.ok ? 'pass' : 'fail')));
      net.appendChild(li);
    });
    $('checkMsg').textContent = r.network.ready ? '檢查完成。請到下一步選擇方案。' : '網路檢查未通過：司法院網站無法連線。若使用 VPN，請切換節點後重試；也可以選擇「不安裝」只用雲端。';
    $('checkMsg').className = r.network.ready ? 'status ok' : 'status error';
  };

  WZ.views.setCheckBusy = function () {
    $('checkMsg').textContent = '檢查中，請稍候…';
    $('checkMsg').className = 'status';
  };

  WZ.views.setCheckError = function (e) {
    $('checkMsg').textContent = '檢查失敗：' + WZ.errMsg(e);
    $('checkMsg').className = 'status error';
  };
})(window.WZ);
