// 頁面模板：登入閘門（覆蓋整個畫面，登入後才顯示主畫面）。
(function (JR) {
  'use strict';

  JR.templates.authGatePage = `
<div class="auth-gate" id="authGate" hidden role="dialog" aria-modal="true" aria-labelledby="authTitle">
  <div class="auth-card">
    <p class="auth-kicker">JUDGE RESEARCH</p>
    <h1 id="authTitle">請先登入</h1>
    <p class="lead">登入後才能使用本程式。登入會在瀏覽器中進行，完成後會自動回到這裡。</p>
    <p class="status" id="authStatus" role="status"></p>
    <div class="actions">
      <button class="btn primary" type="button" id="authStart">開啟瀏覽器登入</button>
      <button class="btn" type="button" id="authCancel" hidden>取消</button>
    </div>
    <p class="hint">登入使用授權頁面提供的帳號方式。若瀏覽器已登入，通常會直接完成。</p>
  </div>
</div>
`;
})(window.JR);
