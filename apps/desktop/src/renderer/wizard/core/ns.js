// 本地模組視窗的命名空間與共用狀態（classic script）。
// 分層：core（工具與常數）→ model（流程規則）→ views（畫面）→ controllers（事件與 IPC）→ main（啟動）。
window.WZ = {
  views: {},
  controllers: {},
  flow: {},
  components: {},
  state: {
    plan: null, choice: null, installStatus: 'idle', lastError: null, failedStage: null,
    agreed: false, installedVersion: null, installStarted: false, maxReached: 0, pendingApply: false
  },
  stageState: {}
};
