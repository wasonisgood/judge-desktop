// 渲染程序命名空間與共用狀態（classic script，不使用模組系統）。
// 分層：templates（頁面標記）→ components（可重用元件）→ views（資料轉畫面）→ controllers（事件與 IPC）→ main（啟動）。
// 檔案只在載入時掛上自己的部分；彼此的呼叫一律發生在執行期，因此載入順序不影響正確性。
window.JR = {
  templates: {},
  components: {},
  views: {},
  controllers: {},
  state: {
    listItems: null, listDetails: null, listKeyword: '', listVerdicts: null,
    brief: null, briefPick: null,
    scopeSheets: null, scopeFrom: null, scopeTo: null,
    fileTab: 'active',
    scopeRunning: false,
    listSeq: 0,
    assistHistory: []
  }
};
