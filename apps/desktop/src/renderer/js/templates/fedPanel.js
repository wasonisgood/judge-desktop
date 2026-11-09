// 頁面模板：fedPanel（v3.7.0）：工作負載身分聯盟的四步引導。本工具是身分提供者，身分權杖由本工具簽發。
// 欄位 ID 沿用 setFed*（設定讀寫仍使用這些 ID）。每一步的內容與狀態由 controllers/federation.js 控制。
(function (JR) {
  'use strict';
  var ICON = {
    issuer: '<svg class="fed-ico" viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="10" width="32" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 18h20M14 25h14M14 32h18" stroke="currentColor" stroke-width="2"/></svg>',
    rule: '<svg class="fed-ico" viewBox="0 0 48 48" aria-hidden="true"><circle cx="16" cy="16" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="32" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 19l6 9" stroke="currentColor" stroke-width="2"/></svg>',
    target: '<svg class="fed-ico" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="18" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 40c2-8 8-11 14-11s12 3 14 11" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    fill: '<svg class="fed-ico" viewBox="0 0 48 48" aria-hidden="true"><path d="M14 8h20v32H14z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19 17h10M19 24h10M19 31h6" stroke="currentColor" stroke-width="2"/></svg>',
    ok: '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    no: '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
  };

  function copyBtn(id) {
    return '<button class="btn small" type="button" data-copy="' + id + '">複製</button>';
  }

  JR.templates.fedPanel = `
<section class="fed" id="fedPanel" aria-labelledby="fedTitle" hidden>
  <header class="fed-head">
    <h3 id="fedTitle">工作負載身分聯盟</h3>
    <p class="hint">本工具是身分提供者：由本工具簽發短效的身分權杖，Anthropic 驗證後換發 API 存取權杖。您不需要保存 API 金鑰。</p>
  </header>

  <ul class="fed-checks" id="fedChecks" aria-live="polite">
    <li id="fedCheckLogin"><span class="fed-tick-wrap" data-tick></span><span>已登入本工具</span></li>
    <li id="fedCheckOrg"><span class="fed-tick-wrap" data-tick></span><span>組織 ID</span></li>
    <li id="fedCheckRule"><span class="fed-tick-wrap" data-tick></span><span>聯盟規則 ID</span></li>
    <li id="fedCheckSvc"><span class="fed-tick-wrap" data-tick></span><span>服務帳戶 ID</span></li>
    <li id="fedCheckFile" hidden><span class="fed-tick-wrap" data-tick></span><span>自備身分憑證檔</span></li>
  </ul>

  <ol class="fed-steps" id="fedSteps" aria-label="設定步驟">
    <li><button type="button" class="fed-step-btn" data-step="1" aria-current="step">${ICON.issuer}<span class="fed-step-no">一</span><span class="fed-step-name">發行者</span></button></li>
    <li><button type="button" class="fed-step-btn" data-step="2">${ICON.rule}<span class="fed-step-no">二</span><span class="fed-step-name">聯盟規則</span></button></li>
    <li><button type="button" class="fed-step-btn" data-step="3">${ICON.target}<span class="fed-step-no">三</span><span class="fed-step-name">服務帳戶</span></button></li>
    <li><button type="button" class="fed-step-btn" data-step="4">${ICON.fill}<span class="fed-step-no">四</span><span class="fed-step-name">填入本工具</span></button></li>
  </ol>

  <!-- 一、發行者：本工具 -->
  <section class="fed-step-body" data-step-body="1">
    <h4>一、發行者（本工具）</h4>
    <p class="hint">在 Anthropic 後台建立「自訂 OIDC」發行者時，填入下列值。這些值由本工具決定，不需要修改。</p>
    <dl class="fed-facts">
      <dt>發行者 URL（iss）</dt><dd><code id="fedIssuer"></code> ${copyBtn('fedIssuer')}</dd>
      <dt>JWKS 來源</dt><dd>OIDC 探索（自動從發行者 URL 取得）</dd>
      <dt>可從公開網際網路存取</dt><dd>是（本工具公開探索文件與金鑰，必須勾選）</dd>
      <dt>受眾（aud）</dt><dd><code id="fedAud"></code> ${copyBtn('fedAud')}</dd>
      <dt>權杖有效期限</dt><dd>建議 1 小時以內；本工具每次換取前重新簽發（約 10 分鐘）</dd>
    </dl>
    <fieldset class="fed-choice">
      <legend>身分權杖從哪裡來？</legend>
      <label class="fed-opt"><input type="radio" name="fedSource" id="fedSourceProvider" value="provider" checked> 本工具簽發（推薦，不需要檔案）</label>
      <label class="fed-opt"><input type="radio" name="fedSource" id="fedSourceFile" value="file"> 自備身分憑證檔（進階，需要您自己的身分提供者）</label>
    </fieldset>
    <div class="fed-row" id="fedFileRow" hidden>
      <label class="fed-field"><span>身分憑證檔案路徑</span><input id="setFedFile" autocomplete="off" placeholder="例如 C:\\Users\\你\\identity.jwt"></label>
    </div>
  </section>

  <!-- 二、聯盟規則 -->
  <section class="fed-step-body" data-step-body="2" hidden>
    <h4>二、聯盟規則（比對哪些權杖）</h4>
    <p class="hint">規則決定哪些身分可以換取權杖。本工具的主體（sub）格式為 <code>desktop:</code> 加上雜湊值。</p>
    <fieldset class="fed-choice">
      <legend>主體（sub）宣告怎麼比對？</legend>
      <label class="fed-opt"><input type="radio" name="fedScope" id="fedScopeAll" value="all" checked> 所有使用本工具的身分（前綴比對 <code>desktop:*</code>）</label>
      <label class="fed-opt"><input type="radio" name="fedScope" id="fedScopeOne" value="one"> 只限我自己的身分（完整比對，需要先取得我的主體）</label>
    </fieldset>
    <div class="fed-row" id="fedSubRow" hidden>
      <button class="btn small" type="button" id="fedPreviewSub">取得我的主體（sub）</button>
      <code id="fedSub" class="fed-sub"></code> ${copyBtn('fedSub')}
    </div>
    <fieldset class="fed-choice">
      <legend>工作區範圍</legend>
      <label class="fed-opt"><input type="radio" name="fedWs" id="fedWsAll" value="all" checked> 所有工作區（後台的預設）</label>
      <label class="fed-opt"><input type="radio" name="fedWs" id="fedWsOne" value="one"> 指定工作區（需要在第四步填入工作區 ID）</label>
    </fieldset>
    <dl class="fed-facts">
      <dt>主體（sub）宣告</dt><dd><code id="fedRuleSub">desktop:*</code> ${copyBtn('fedRuleSub')}</dd>
      <dt>受眾</dt><dd><code>https://api.anthropic.com</code></dd>
      <dt>OAuth 範圍</dt><dd>workspace:developer（預設即可）</dd>
    </dl>
  </section>

  <!-- 三、服務帳戶 -->
  <section class="fed-step-body" data-step-body="3" hidden>
    <h4>三、服務帳戶（本工具以此身分操作）</h4>
    <p class="hint">建議新建一個專用的服務帳戶，權限只給本工具需要的工作區成員角色。建立後，後台會顯示以 <code>svac_</code> 開頭的服務帳戶 ID。</p>
    <dl class="fed-facts">
      <dt>建議名稱</dt><dd><code>judge-desktop</code> ${copyBtn('fedSvcName')}<span id="fedSvcName" hidden>judge-desktop</span></dd>
      <dt>下一步</dt><dd>把後台顯示的服務帳戶 ID（svac_…）填入第四步。</dd>
    </dl>
  </section>

  <!-- 四、填入本工具 -->
  <section class="fed-step-body" data-step-body="4" hidden>
    <h4>四、把後台的代碼填入本工具</h4>
    <p class="hint">逐項填入。欄位旁會即時提示格式是否正確；全部正確後才能測試連線。</p>
    <div class="fed-row">
      <label class="fed-field"><span>組織 ID</span><input id="setFedOrg" autocomplete="off" placeholder="例如 8c5aaae2-1c0c-4f73-94f8-a8b8d4b6a015"><small id="fedMsgOrg" class="fed-msg"></small></label>
      <label class="fed-field"><span>聯盟規則 ID</span><input id="setFedRule" autocomplete="off" placeholder="fdrl_…"><small id="fedMsgRule" class="fed-msg"></small></label>
    </div>
    <div class="fed-row">
      <label class="fed-field"><span>服務帳戶 ID</span><input id="setFedSvc" autocomplete="off" placeholder="svac_…"><small id="fedMsgSvc" class="fed-msg"></small></label>
      <label class="fed-field"><span>工作區 ID（選填）</span><input id="setFedWorkspace" autocomplete="off" placeholder="wrkspc_…"><small id="fedMsgWs" class="fed-msg"></small></label>
    </div>
    <p class="hint" id="fedSummary" role="status"></p>
  </section>

  <div class="fed-nav">
    <button class="btn" type="button" id="fedPrev">上一步</button>
    <button class="btn" type="button" id="fedNext">下一步</button>
  </div>
</section>
`;
})(window.JR);
