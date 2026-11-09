// 頁面模板：crawlPage（文本擷取：JudgementsCrawler 五步流程）。
(function (JR) {
  'use strict';
  JR.templates.crawlPage = `
      <section class="page" id="page-crawl">
        <h1>文本擷取</h1>
        <p class="lead">依序執行五步：取得清單 → 取得文本 → 歷審 → 歷審文本 → 確定判決。每次連線間隔 3 秒（每次最多 25 頁、500 筆）。單筆失敗不中斷整批，原因寫入擷取紀錄。輸出檔案放在輸入檔所在的資料夾，同名時加 _2、_3，不覆蓋既有成果。</p>
        <p class="status" id="crawlStatus" role="status"></p>
        <div class="crawl-steps">
          <div class="crawl-step">
            <h2>Step 1 取得清單</h2>
            <p class="hint">輸入查詢關鍵字，或貼上司法院查詢結果網址。產生 Index／Title／URL 清單。</p>
            <div class="crawl-row">
              <input type="text" id="crawlQuery" placeholder="關鍵字或查詢結果網址" />
              <button class="btn primary" type="button" data-run="1">執行</button>
            </div>
          </div>
          <div class="crawl-step">
            <h2>Step 2 取得文本</h2>
            <p class="hint">選擇清單檔（.xlsx 或 .csv），取得各案全文（清單序號.txt）與擷取紀錄。</p>
            <div class="crawl-row">
              <span class="crawl-file" id="crawlFile2">尚未選擇</span>
              <button class="btn" type="button" data-pick="2">選擇檔案</button>
              <button class="btn primary" type="button" data-run="2">執行</button>
            </div>
          </div>
          <div class="crawl-step">
            <h2>Step 3 歷審</h2>
            <p class="hint">選擇清單檔，產生各案的歷審清單（清單_歷審.xlsx）。單一審級案件標為「歷審_1」。</p>
            <div class="crawl-row">
              <span class="crawl-file" id="crawlFile3">尚未選擇</span>
              <button class="btn" type="button" data-pick="3">選擇檔案</button>
              <button class="btn primary" type="button" data-run="3">執行</button>
            </div>
          </div>
          <div class="crawl-step">
            <h2>Step 4 歷審文本</h2>
            <p class="hint">選擇 Step 3 產生的「…_歷審.xlsx」，取得各審級全文（清單序號-歷審序號.txt）。</p>
            <div class="crawl-row">
              <span class="crawl-file" id="crawlFile4">尚未選擇</span>
              <button class="btn" type="button" data-pick="4">選擇檔案</button>
              <button class="btn primary" type="button" data-run="4">執行</button>
            </div>
          </div>
          <div class="crawl-step">
            <h2>Step 5 確定判決</h2>
            <p class="hint">逐一判斷每位被告的判決是否確定，產生清單_確定判決.xlsx。上訴期間（天）預設 120。</p>
            <div class="crawl-row">
              <span class="crawl-file" id="crawlFile5">尚未選擇</span>
              <button class="btn" type="button" data-pick="5">選擇檔案</button>
              <label class="crawl-days">上訴期間 <input type="number" id="crawlAppealDays" min="1" max="1000" value="120" /> 天</label>
              <button class="btn primary" type="button" data-run="5">執行</button>
            </div>
          </div>
        </div>
        <div class="progress" id="crawlProgress" hidden><div class="bar"></div></div>
        <button class="btn" type="button" id="crawlCancel" hidden>取消</button>
        <div class="crawl-result" id="crawlResult" role="region" aria-live="polite"></div>
      </section>
`;
})(window.JR);
