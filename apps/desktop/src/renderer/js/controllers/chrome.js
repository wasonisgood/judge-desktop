// 控制器：視窗控制、深色模式、頁面切換（導覽列與首頁的入口按鈕）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;

  // 頁面切換：進入設定或檔案頁時重新讀取資料。
  JR.nav = {
    showPage: function (name) {
      document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + name); });
      document.querySelectorAll('.rail-item').forEach(function (n) { n.classList.toggle('active', n.dataset.page === name); });
      if (name === 'settings') JR.controllers.settings.load();
      if (name === 'files') JR.controllers.files.load();
    }
  };

  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('themeToggle').checked = dark;
  }

  JR.controllers.chrome = {
    bind: function () {
      document.querySelectorAll('[data-win]').forEach(function (b) {
        b.addEventListener('click', function () { api.win[b.dataset.win](); });
      });

      var saved = null;
      try { saved = localStorage.getItem('theme'); } catch (e) { /* 忽略 */ }
      applyTheme(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
      $('themeToggle').addEventListener('change', function () {
        var dark = $('themeToggle').checked;
        applyTheme(dark);
        try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) { /* 忽略 */ }
      });

      document.querySelectorAll('[data-page]').forEach(function (b) {
        b.addEventListener('click', function () { JR.nav.showPage(b.dataset.page); });
      });
      document.querySelectorAll('[data-go]').forEach(function (b) {
        b.addEventListener('click', function () { JR.nav.showPage(b.dataset.go); });
      });
    }
  };
})(window.JR);
