// 背景工作通知視窗（v3.9.0）：顯示工作名稱、狀態與摘要；點擊開啟對應頁面，滑鼠停留時暫停自動關閉。
(function () {
  'use strict';
  var api = window.api;
  var params = new URLSearchParams(window.location.search);

  // 深色模式與主視窗一致（同一個 file:// 來源的 localStorage）。
  var saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* 忽略 */ }
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

  var toast = document.getElementById('toast');
  var kind = params.get('kind') || 'done';
  var page = params.get('page') || 'home';
  toast.setAttribute('data-kind', kind);
  document.getElementById('toastStatus').textContent = params.get('status') || '';
  document.getElementById('toastTitle').textContent = params.get('heading') || '';
  document.getElementById('toastBody').textContent = params.get('body') || '';
  document.title = params.get('heading') || '背景工作通知';

  function click() {
    if (api && api.worker) api.worker.notice.click(page);
  }
  toast.addEventListener('click', function (ev) {
    if (ev.target && ev.target.id === 'toastClose') return;
    click();
  });
  toast.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); click(); }
  });
  document.getElementById('toastClose').addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (api && api.worker) api.worker.notice.dismiss();
  });
  toast.addEventListener('mouseenter', function () {
    if (api && api.worker) api.worker.notice.hold();
  });
  toast.addEventListener('mouseleave', function () {
    if (api && api.worker) api.worker.notice.leave();
  });
})();
