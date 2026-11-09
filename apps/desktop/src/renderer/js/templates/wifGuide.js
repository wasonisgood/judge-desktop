// 頁面模板：wifGuide（由原 index.html 逐字拆出，DOM 結構不變）。
(function (JR) {
  'use strict';
  // 工作負載身分聯合的四步操作說明（設定頁內的獨立元件）。
  JR.templates.wifGuide = `
<section class="wif-guide" aria-labelledby="wifGuideTitle">
  <h2 id="wifGuideTitle">工作負載身分聯合：操作步驟</h2>
  <p class="hint">由提供者代為連線時，您不需要自己申請金鑰。請依下列四步完成設定。</p>
  <ol class="wif-steps">
    <li class="wif-step">
      <svg class="wif-art" viewBox="0 0 160 84" role="img" aria-label="步驟一：取得三組代碼">
        <rect x="14" y="16" width="132" height="52" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <line x1="28" y1="32" x2="78" y2="32" stroke="currentColor" stroke-width="1.5"/>
        <line x1="28" y1="44" x2="110" y2="44" stroke="currentColor" stroke-width="1.5"/>
        <line x1="28" y1="56" x2="96" y2="56" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="124" cy="56" r="8" fill="none" stroke="var(--shu)" stroke-width="1.5"/>
        <path d="M120 56 L123 59 L129 52" fill="none" stroke="var(--shu)" stroke-width="1.5"/>
      </svg>
      <div class="wif-text">
        <p class="wif-no">一</p>
        <p><strong>向提供者取得三組代碼</strong></p>
        <p>組織 ID、聯合規則 ID（fdrl 開頭）、服務帳號 ID（svac 開頭）。這三組代碼由提供者在 Claude Console 中建立。</p>
      </div>
    </li>
    <li class="wif-step">
      <svg class="wif-art" viewBox="0 0 160 84" role="img" aria-label="步驟二：準備身分憑證檔">
        <path d="M52 12 H96 L116 32 V72 H52 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <path d="M96 12 V32 H116" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <text x="66" y="54" font-size="13" fill="var(--shu-ink)">JWT</text>
        <line x1="66" y1="62" x2="102" y2="62" stroke="currentColor" stroke-width="1"/>
      </svg>
      <div class="wif-text">
        <p class="wif-no">二</p>
        <p><strong>準備身分憑證（JWT）檔案</strong></p>
        <p>由您自己的身分提供者（例如 GitHub Actions、Google 或自架的 OIDC 服務）發出身分憑證，存成一個純文字檔。每次連線時程式都會重新讀取這個檔案。</p>
      </div>
    </li>
    <li class="wif-step">
      <svg class="wif-art" viewBox="0 0 160 84" role="img" aria-label="步驟三：填入設定欄位">
        <rect x="20" y="10" width="120" height="64" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <rect x="32" y="20" width="96" height="12" fill="none" stroke="currentColor" stroke-width="1"/>
        <rect x="32" y="38" width="96" height="12" fill="none" stroke="currentColor" stroke-width="1"/>
        <rect x="32" y="56" width="96" height="12" fill="none" stroke="var(--shu)" stroke-width="1.5"/>
        <line x1="36" y1="62" x2="72" y2="62" stroke="var(--shu)" stroke-width="1.5"/>
      </svg>
      <div class="wif-text">
        <p class="wif-no">三</p>
        <p><strong>在下方填入設定</strong></p>
        <p>依序填入組織 ID、聯合規則 ID、服務帳號 ID，以及身分憑證檔案的完整路徑。規則涵蓋多個工作區時，才需要填工作區 ID。</p>
      </div>
    </li>
    <li class="wif-step">
      <svg class="wif-art" viewBox="0 0 160 84" role="img" aria-label="步驟四：測試連線">
        <circle cx="80" cy="42" r="26" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <path d="M68 42 L77 51 L93 33" fill="none" stroke="var(--shu)" stroke-width="2.5"/>
      </svg>
      <div class="wif-text">
        <p class="wif-no">四</p>
        <p><strong>按「儲存」，再按「測試連線」</strong></p>
        <p>看到「連線成功」即完成。若顯示失敗，請確認身分憑證是否過期、檔案路徑是否正確，並向提供者確認規則設定。</p>
      </div>
    </li>
  </ol>
</section>
`;
})(window.JR);
