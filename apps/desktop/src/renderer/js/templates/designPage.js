// 頁面模板：designPage（研究設計：AI 多輪對話，按鈕對應為 AI 可呼叫的工具）。
(function (JR) {
  'use strict';
  JR.templates.designPage = `
      <section class="page" id="page-design">
        <h1>研究設計</h1>
        <p class="lead">用口語描述想研究的問題。助理會與你多輪對話，協助選定研究對象、主題與條件；它可以替你填寫欄位、試搜尋判決數，並把法規與期間帶入標編碼標注工序。欄位隨時可以手動修改。</p>
        <div class="design-bar">
          <label class="field">
            <span>已保存的研究設計</span>
            <select id="designSelect"></select>
          </label>
          <button class="btn" type="button" id="designNew">新的研究設計</button>
          <button class="btn danger" type="button" id="designRemove" disabled>刪除</button>
        </div>

        <div class="design-layout">
          <section class="design-chat" aria-label="研究設計對話">
            <div class="design-log" id="designLog" role="log" aria-live="polite"></div>
            <form class="design-composer" id="designAnswerForm">
              <textarea id="designAnswer" rows="3" autocomplete="off" placeholder="例如：我覺得消費者訴訟的判決都對消費者不利，想知道是不是真的"></textarea>
              <div class="actions">
                <button class="btn primary" type="submit" id="designAnswerSend">送出</button>
                <button class="btn" type="button" id="designCancel" hidden>取消</button>
                <span class="hint">Ctrl+Enter 送出</span>
              </div>
            </form>
          </section>

          <aside class="design-side">
            <section class="design-section">
              <h2>欄位</h2>
              <p class="hint">助理填入的內容也會出現在這裡。可以直接修改，按「儲存欄位」後生效；清空就是取消該欄位。</p>
              <form class="form" id="designFieldsForm">
                <label class="field"><span>研究問題</span><input id="designF-question" type="text"></label>
                <label class="field"><span>研究對象</span><input id="designF-subject" type="text"></label>
                <label class="field"><span>變項</span><input id="designF-variable" type="text"></label>
                <label class="field"><span>法規</span><input id="designF-statute" type="text" placeholder="例如：消費者保護法第7條"></label>
                <div class="row">
                  <label class="field"><span>起始年（西元）</span><input id="designF-yearFrom" type="number" min="1900" max="2200"></label>
                  <label class="field"><span>結束年（西元）</span><input id="designF-yearTo" type="number" min="1900" max="2200"></label>
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
          </aside>
        </div>
        <p class="status" id="designStatus" role="status"></p>
      </section>
`;
})(window.JR);
