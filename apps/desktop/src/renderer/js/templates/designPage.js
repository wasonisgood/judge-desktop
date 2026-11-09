// 頁面模板：designPage（研究設計引導，issue #11）。
(function (JR) {
  'use strict';
  JR.templates.designPage = `
      <section class="page" id="page-design">
        <h1>研究設計引導</h1>
        <p class="lead">從模糊的問題意識開始，一步一步凝練成可以用判決實證的研究題目。每一步都會說明理由；所有建議都只是選項，接受後才會改變設定。不設定 AI 也能完整操作，欄位可以手動填寫。</p>
        <div class="design-bar">
          <label class="field">
            <span>已保存的研究設計</span>
            <select id="designSelect"></select>
          </label>
          <button class="btn" type="button" id="designNew">新的研究設計</button>
          <button class="btn danger" type="button" id="designRemove" disabled>刪除</button>
        </div>

        <form class="form" id="designStartForm" hidden>
          <label class="field">
            <span>你的問題意識（可以很模糊）</span>
            <textarea id="designProblem" rows="3" placeholder="例如：我覺得消費者訴訟的判決都對消費者不利，想知道是不是真的"></textarea>
          </label>
          <div class="actions"><button class="btn primary" type="submit" id="designStart">開始</button></div>
        </form>

        <div id="designWork" hidden>
          <div class="design-log" id="designLog" role="log" aria-live="polite"></div>

          <form class="form design-answer" id="designAnswerForm">
            <div class="design-next" id="designNext"></div>
            <label class="field">
              <span>你的回答</span>
              <textarea id="designAnswer" rows="2" autocomplete="off"></textarea>
            </label>
            <div class="actions">
              <button class="btn primary" type="submit" id="designAnswerSend">送出回答</button>
              <button class="btn" type="button" id="designAiFill" title="需要已設定的 AI；只會把整理結果填入下方欄位，不會直接儲存">AI 整理成欄位</button>
            </div>
          </form>

          <section class="design-section">
            <h2>可實證性檢查</h2>
            <p class="hint">判斷題目能否由判決原文回答。標示「不足」的項目需要先補上，否則無法實證。</p>
            <ul class="design-checks" id="designChecks"></ul>
          </section>

          <section class="design-section">
            <h2>範圍縮小建議</h2>
            <p class="hint">每則建議都說明理由與代價。接受後才會寫入欄位；略過則不做任何改動。</p>
            <div id="designSuggestions"></div>
          </section>

          <section class="design-section">
            <h2>欄位</h2>
            <p class="hint">可以直接修改，按「儲存欄位」後才生效。清空就是取消該欄位。</p>
            <form class="form" id="designFieldsForm">
              <div class="row">
                <label class="field"><span>研究問題</span><input id="designF-question" type="text"></label>
                <label class="field"><span>研究對象</span><input id="designF-subject" type="text"></label>
              </div>
              <div class="row">
                <label class="field"><span>變項</span><input id="designF-variable" type="text"></label>
                <label class="field"><span>法規</span><input id="designF-statute" type="text" placeholder="例如：消費者保護法第7條"></label>
              </div>
              <div class="row">
                <label class="field"><span>期間（起始年，西元）</span><input id="designF-yearFrom" type="number" min="1900" max="2200"></label>
                <label class="field"><span>期間（結束年，西元）</span><input id="designF-yearTo" type="number" min="1900" max="2200"></label>
              </div>
              <div class="row">
                <label class="field"><span>案件類型（需人工篩選）</span><input id="designF-caseType" type="text" placeholder="民事、刑事或行政"></label>
                <label class="field"><span>法院層級（需人工篩選）</span><input id="designF-courtLevel" type="text" placeholder="地方法院、高等法院或最高法院"></label>
              </div>
              <div class="actions">
                <button class="btn primary" type="submit" id="designSaveFields">儲存欄位</button>
              </div>
            </form>
          </section>

          <section class="design-section">
            <h2>研究設計摘要</h2>
            <pre class="design-summary" id="designSummary"></pre>
            <div class="actions">
              <button class="btn" type="button" id="designExportDocx">匯出 Word</button>
              <button class="btn" type="button" id="designExportTxt">匯出文字</button>
              <button class="btn" type="button" id="designToScope" title="把法規與期間帶入範圍整理（案件類型與審級需在列表中人工篩選）">帶入範圍整理</button>
            </div>
          </section>
        </div>
        <p class="status" id="designStatus" role="status"></p>
      </section>
`;
})(window.JR);
