// 頁面模板：scopePage（標編碼標注工序；內部識別碼仍為 scope）。
// 版面：頁首 → 固定位置的操作列（執行、流程、AI 來源、匯出）→ 固定位置的狀態列 → 三個編號區塊（搜尋範圍、執行條件、分析欄位表）→ 結果。
// 區塊內容以「標籤欄＋數值欄」的定義列呈現；分析欄位為有標頭列的表格。
(function (JR) {
  'use strict';
  JR.templates.scopePage = `
      <section class="page" id="page-scope">
        <header class="scope-head">
          <h1>標編碼標注工序</h1>
          <p class="lead">輸入關鍵字（可用一句話描述範圍）或法規（每行一部），列出判決，並依勾選的分析欄位由 AI 編碼。每個欄位都附判決原文的逐字依據；依據對不上的欄位會標示為待覆核。需要先在「設定」輸入 AI 金鑰。</p>
        </header>
        <form class="form scope-form" id="scopeForm">
          <div class="scope-bar" role="toolbar" aria-label="操作">
            <div class="scope-bar-main">
              <button class="btn primary" type="submit" id="scopeRun">開始整理</button>
              <button class="btn" type="button" id="scopeCancel" hidden>取消</button>
              <button class="btn" type="button" id="scopeExplain" disabled>查看處理流程</button>
            </div>
            <div class="scope-bar-export">
              <select id="scopeAi" class="ai-source" title="AI 來源">
                <option value="auto">AI：自動（本地優先）</option>
                <option value="local">AI：本地模型</option>
                <option value="cloud" selected>AI：雲端</option>
              </select>
              <button class="btn" type="button" id="scopeXlsx" disabled>匯出 Excel</button>
              <button class="btn" type="button" id="scopeDocx" disabled>匯出 Word</button>
            </div>
          </div>
          <div class="scope-statusbar" aria-live="polite">
            <p class="hint scope-reason" id="scopeActionHint" role="status"></p>
            <div class="progress" id="scopeProgress" hidden><div class="bar"></div></div>
            <p class="status" id="scopeStatus" role="status"></p>
          </div>
          <div class="clarify" id="scopeClarify" hidden></div>

          <section class="scope-sec" aria-labelledby="scopeSec1">
            <h2 id="scopeSec1">一、搜尋範圍</h2>
            <dl class="scope-deflist">
              <div class="scope-def">
                <dt><label for="scopeJurisdiction">管轄區</label></dt>
                <dd><select id="scopeJurisdiction"></select></dd>
              </div>
              <div class="scope-def">
                <dt><label for="scopeCaseType">案件類型</label></dt>
                <dd>
                  <select id="scopeCaseType">
                    <option value="">不限</option>
                    <option value="民事">民事</option>
                    <option value="刑事">刑事</option>
                    <option value="行政">行政</option>
                  </select>
                  <small class="hint">選填，依判決字號篩選。</small>
                </dd>
              </div>
              <div class="scope-def">
                <dt><label for="scopeKeyword">關鍵字</label></dt>
                <dd>
                  <input id="scopeKeyword" placeholder="例如：國家賠償 戒嚴 回復原狀" autocomplete="off">
                  <small class="hint">選填，可用一句話描述範圍。</small>
                </dd>
              </div>
              <div class="scope-def">
                <dt><label for="scopeRelated">相關法規</label></dt>
                <dd>
                  <input id="scopeRelated" placeholder="例如：國家賠償法" autocomplete="off">
                  <small class="hint">選填；智慧搜尋時 AI 會先讀入現行條文與沿革。</small>
                </dd>
              </div>
              <div class="scope-def">
                <dt>相關法規篩選</dt>
                <dd>
                  <label class="check"><input type="checkbox" id="scopeRelatedOnly"><span>只保留引用相關法規的判決（預設關閉，與判決列表相同）</span></label>
                  <small class="fed-msg scope-msg" id="scopeRelatedOnlyMsg" role="status"></small>
                </dd>
              </div>
              <div class="scope-def">
                <dt>智慧搜尋</dt>
                <dd>
                  <label class="check"><input type="checkbox" id="scopeSmart"><span>AI 會自動調整關鍵字（最多 3 輪，未設定 AI 時只查一次）</span></label>
                  <small class="fed-msg scope-msg" id="scopeSmartMsg" role="status"></small>
                </dd>
              </div>
              <div class="scope-def">
                <dt><label for="scopeLines">法規</label></dt>
                <dd>
                  <textarea id="scopeLines" rows="3" placeholder="例如：&#10;國家賠償法&#10;民法第184條第1項"></textarea>
                  <small class="hint">選填，每行一部；可以只寫法名，也可以寫到條、項、款。法名需與全國法規資料庫的正式名稱相同。</small>
                </dd>
              </div>
            </dl>
          </section>

          <section class="scope-sec" aria-labelledby="scopeSec2">
            <h2 id="scopeSec2">二、執行條件</h2>
            <dl class="scope-deflist">
              <div class="scope-def">
                <dt><label for="scopeFrom">起始年</label></dt>
                <dd><input id="scopeFrom" type="number" min="1945" max="2100" placeholder="西元，例如 2000"></dd>
              </div>
              <div class="scope-def">
                <dt><label for="scopeTo">結束年</label></dt>
                <dd><input id="scopeTo" type="number" min="1945" max="2100" placeholder="西元，例如 2026"></dd>
              </div>
              <div class="scope-def">
                <dt><label for="scopeMax">最多筆數</label></dt>
                <dd><input id="scopeMax" type="number" min="1" max="100" value="30"><small class="hint">每個關鍵字或法規。</small></dd>
              </div>
              <div class="scope-def">
                <dt>AI 分析</dt>
                <dd><label class="check"><input type="checkbox" id="scopeAiOn" checked><span>啟用逐案編碼與綜合（關閉時只做傳統篩選，不需要 AI）</span></label></dd>
              </div>
            </dl>
          </section>

          <section class="scope-sec" aria-labelledby="scopeSec3">
            <h2 id="scopeSec3">三、分析欄位</h2>
            <table class="table scope-fields" aria-describedby="scopeSec3">
              <thead>
                <tr>
                  <th scope="col">欄位名稱</th>
                  <th scope="col">說明</th>
                  <th scope="col" class="scope-col-on">納入</th>
                  <th scope="col" class="scope-col-order">排序</th>
                  <th scope="col" class="scope-col-ops">操作</th>
                </tr>
              </thead>
              <tbody id="scopeFieldList"></tbody>
            </table>
            <div class="actions">
              <button class="btn small" type="button" id="scopeFieldAdd">加入自訂欄位</button>
            </div>
            <p class="hint">只會編碼勾選的欄位，並依表格順序排列。每個欄位的依據都必須是判決原文的逐字引用。</p>
          </section>
        </form>
        <div id="scopeResult"></div>
      </section>
`;
})(window.JR);
