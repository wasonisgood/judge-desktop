// 控制器：工作負載身分聯盟引導面板（v3.7.0）。四步切換、即時檢查草稿、可複製的值、預覽主體（sub）。
// 「送出前」隨時可以按「儲存」；只有設定完整且已登入時，「測試連線」才會啟用。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;
  var step = 1;
  var timer = null;
  var MSG_ID = { organizationId: 'fedMsgOrg', federationRuleId: 'fedMsgRule', serviceAccountId: 'fedMsgSvc', workspaceId: 'fedMsgWs' };
  var TICK_OK = '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  var TICK_NO = '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  function isFedMode() { return $('setAuthMode').value === 'federation'; }

  function values() {
    return {
      organizationId: $('setFedOrg').value,
      federationRuleId: $('setFedRule').value,
      serviceAccountId: $('setFedSvc').value,
      workspaceId: $('setFedWorkspace').value,
      identitySource: $('fedSourceFile').checked ? 'file' : 'provider',
      identityTokenFile: $('setFedFile').value
    };
  }

  function setStep(n) {
    step = n;
    document.querySelectorAll('#fedSteps .fed-step-btn').forEach(function (b) {
      var on = Number(b.getAttribute('data-step')) === n;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('#fedPanel [data-step-body]').forEach(function (sec) {
      sec.hidden = Number(sec.getAttribute('data-step-body')) !== n;
    });
    $('fedPrev').disabled = n === 1;
    $('fedNext').disabled = n === 4;
  }

  function setTick(id, ok) {
    var li = $(id);
    if (!li) return;
    li.classList.toggle('ok', !!ok);
    li.classList.toggle('bad', !ok);
    li.querySelector('[data-tick]').innerHTML = ok ? TICK_OK : TICK_NO;
  }

  function render(res) {
    var v = values();
    var byField = {};
    res.problems.forEach(function (p) { byField[p.field] = p.message; });
    Object.keys(MSG_ID).forEach(function (k) {
      var el = $(MSG_ID[k]);
      var msg = byField[k];
      el.textContent = msg || (v[k] ? '格式正確' : '');
      el.className = 'fed-msg ' + (msg ? 'bad' : (v[k] ? 'good' : ''));
    });
    var fileMode = v.identitySource === 'file';
    setTick('fedCheckLogin', res.hasSession);
    setTick('fedCheckOrg', !byField.organizationId && !!v.organizationId);
    setTick('fedCheckRule', !byField.federationRuleId && !!v.federationRuleId);
    setTick('fedCheckSvc', !byField.serviceAccountId && !!v.serviceAccountId);
    if (fileMode) setTick('fedCheckFile', !byField.identityTokenFile && !!v.identityTokenFile);
    var missing = [];
    if (!res.hasSession && !fileMode) missing.push('尚未登入本工具：請先在上方「帳號」登入。');
    res.problems.forEach(function (p) { missing.push(p.message); });
    var summary = $('fedSummary');
    summary.textContent = missing.length ? '尚缺：' + missing.join(' ') : '設定完整。請先按「儲存」，再按「測試連線」（測試使用已儲存的設定）。';
    summary.className = 'hint ' + (missing.length ? 'bad' : 'good');
    if (isFedMode()) $('setTest').disabled = missing.length > 0;
  }

  function check() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      api.settings.federationCheck(values()).then(render).catch(function (err) {
        $('fedSummary').textContent = '檢查失敗：' + JR.errText(err);
      });
    }, 150);
  }

  function applySource() {
    var file = $('fedSourceFile').checked;
    $('fedFileRow').hidden = !file;
    $('fedCheckFile').hidden = !file;
    check();
  }

  function applyScope() {
    var one = $('fedScopeOne').checked;
    $('fedSubRow').hidden = !one;
    $('fedRuleSub').textContent = one ? ($('fedSub').textContent || '（先按「取得我的主體」）') : 'desktop:*';
  }

  function notice(msg, kind) { JR.components.notice(msg); if (kind === 'error') JR.setStatus($('setStatus'), msg, 'error'); }

  function copyText(id) {
    var el = document.getElementById(id);
    var text = el ? el.textContent.trim() : '';
    if (!text) return;
    try {
      navigator.clipboard.writeText(text).then(function () { notice('已複製：' + text); }, function () { notice('無法複製，請手動選取。'); });
    } catch (e) {
      notice('無法複製，請手動選取。');
    }
  }

  JR.controllers.federation = {
    /** 切到聯盟模式時載入發行者與受眾（本工具的固定值），並檢查草稿。 */
    refresh: function () {
      api.settings.federationStatus().then(function (s) {
        $('fedIssuer').textContent = s.issuer;
        $('fedAud').textContent = s.audience;
        $('fedSource' + (s.source === 'file' ? 'File' : 'Provider')).checked = true;
        applySource();
        applyScope();
        check();
      }).catch(function (err) {
        $('fedSummary').textContent = '無法讀取聯盟狀態：' + JR.errText(err);
      });
    },
    bind: function () {
      ['setFedOrg', 'setFedRule', 'setFedSvc', 'setFedWorkspace', 'setFedFile'].forEach(function (id) {
        $(id).addEventListener('input', check);
      });
      $('fedSourceProvider').addEventListener('change', applySource);
      $('fedSourceFile').addEventListener('change', applySource);
      $('fedScopeAll').addEventListener('change', applyScope);
      $('fedScopeOne').addEventListener('change', applyScope);
      document.querySelectorAll('#fedSteps .fed-step-btn').forEach(function (b) {
        b.addEventListener('click', function () { setStep(Number(b.getAttribute('data-step'))); });
      });
      $('fedPrev').addEventListener('click', function () { setStep(Math.max(1, step - 1)); });
      $('fedNext').addEventListener('click', function () { setStep(Math.min(4, step + 1)); });
      $('fedPreviewSub').addEventListener('click', function () {
        $('fedPreviewSub').disabled = true;
        api.settings.federationPreviewSub().then(function (r) {
          $('fedSub').textContent = r.sub;
          applyScope();
          notice('已取得主體（sub），可按「複製」貼到後台的主體欄位。');
        }).catch(function (err) {
          notice('取得主體失敗：' + JR.errText(err), 'error');
        }).finally(function () { $('fedPreviewSub').disabled = false; });
      });
      document.querySelectorAll('#fedPanel [data-copy]').forEach(function (b) {
        b.addEventListener('click', function () { copyText(b.getAttribute('data-copy')); });
      });
      setStep(1);
    },
    /** 供設定頁讀取：目前聯盟來源（provider 或 file）。 */
    source: function () { return $('fedSourceFile').checked ? 'file' : 'provider'; },
    check: check
  };
})(window.JR);
