// 自然語言輸入（共用）：送出前由主程序判斷輸入是關鍵字或自然語言。
// 關鍵字原樣回傳（mode: 'keyword'）；自然語言回傳 AI 整理的欄位（mode: 'natural'）。沒有 AI 金鑰時會 reject，畫面顯示原因。
(function (JR) {
  'use strict';
  var api = window.api;

  JR.nl = {
    interpret: function (page, text, ai) {
      return api.nl.interpret({ page: page, text: text, ai: ai || 'auto' });
    }
  };
})(window.JR);
