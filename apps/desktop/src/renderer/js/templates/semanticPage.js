// 頁面模板：semanticPage（事實見解檢索，issue #10）。以關鍵字取候選，再依段落排序；結果內小助手只回答目前結果集。
(function (JR) {
  'use strict';
  JR.templates.semanticPage = `
      <section class="page" id="page-semantic">
        <h1>段落檢索</h1>
        <p class="lead">先以關鍵字取得候選判決（最多 500 筆），再依研究問題對判決的「法律事實」或「法官見解」段落排序。分數為 AI 評分，非向量相似度；每筆結果都附段落原文，可展開全文。需要先在「設定」輸入 AI 金鑰，未設定時會以關鍵字排序並標示。</p>
        <form class="form" id="semForm">
          <div class="row">
            <label class="field">
              <span>候選關鍵字</span>
              <input id="semKeyword" required placeholder="例如：冒充檢察官" autocomplete="off">
            </label>
            <label class="field">
              <span>段落範圍</span>
              <select id="semKind">
                <option value="fact">法律事實（犯罪事實）</option>
                <option value="opinion">法官見解（理由）</option>
              </select>
            </label>
          </div>
          <label class="field">
            <span>研究問題（AI 依此排序段落）</span>
            <textarea id="semQuery" rows="2" placeholder="例如：冒充檢察官要求匯款至指定帳戶" autocomplete="off"></textarea>
          </label>
          <div class="row">
            <label class="field">
              <span>法院</span>
              <select id="semCourt">
                <option value="all">全部法院</option>
                <option value="supreme">最高法院</option>
                <option value="high">高等法院</option>
                <option value="district">地方法院</option>
              </select>
            </label>
            <label class="field">
              <span>案件類型</span>
              <select id="semType">
                <option value="all">全部類型</option>
                <option value="criminal">刑事</option>
                <option value="civil">民事</option>
                <option value="family">家事</option>
                <option value="administrative">行政</option>
              </select>
            </label>
            <label class="field">
              <span>候選上限（最多 500，每筆都要讀取內文）</span>
              <input id="semMax" type="number" min="1" max="500" value="200">
            </label>
            <label class="field">
              <span>起始年（西元，選填）</span>
              <input id="semFrom" type="number" min="1945" max="2100" placeholder="例如 2015">
            </label>
            <label class="field">
              <span>結束年（西元，選填）</span>
              <input id="semTo" type="number" min="1945" max="2100" placeholder="例如 2026">
            </label>
          </div>
          <div class="actions">
            <select id="semAi" class="ai-source" title="AI 來源">
              <option value="auto">AI：自動（本地優先）</option>
              <option value="local">AI：本地模型</option>
              <option value="cloud">AI：雲端</option>
            </select>
            <button class="btn primary" type="submit" id="semRun">檢索並排序</button>
            <button class="btn" type="button" id="semCancel" hidden>取消</button>
          </div>
          <div class="progress" id="semProgress" hidden><div class="bar"></div></div>
          <p class="status" id="semStatus" role="status"></p>
        </form>
        <div class="semantic-summary" id="semSummary" hidden>
          <div class="row">
            <label class="field">
              <span>排序</span>
              <select id="semSort">
                <option value="similarity">依 AI 評分排序</option>
                <option value="caseNo">依案號排序</option>
              </select>
            </label>
          </div>
          <p class="hint" id="semScoreNote"></p>
          <div class="semantic-notice" id="semNotice" role="alert" hidden></div>
        </div>
        <div id="semResult"></div>
        <section class="semantic-assist" aria-labelledby="semAssistTitle">
          <h2 id="semAssistTitle">結果內小助手</h2>
          <p class="hint">只根據目前的結果集回答，每個結論都附案號；引用結果集以外案號的回答會標示為不可採信。對話紀錄只保存在本機，不會同步。</p>
          <div class="semantic-chat" id="semLog" role="log" aria-live="polite"></div>
          <form class="form" id="semAskForm">
            <label class="field">
              <span>問題</span>
              <textarea id="semQuestion" rows="2" placeholder="例如：這些判決認為被告的悔悟態度如何影響量刑？" autocomplete="off"></textarea>
            </label>
            <div class="actions">
              <button class="btn primary" type="submit" id="semAsk" disabled>詢問</button>
              <button class="btn" type="button" id="semClearChat">清除對話</button>
            </div>
            <p class="status" id="semAskStatus" role="status"></p>
          </form>
        </section>
      </section>
`;
})(window.JR);
