// 本地模組的公開介面（門面）：實際實作分層於 data/local（本地資料）、data/cloud（雲端來源）、services（流程）。
// 呼叫端（IPC、雲端路由）只從這裡取用，內部檔案可獨立調整。
// 判斷邏輯都在 @judge/core（有單元測試）；這裡與系統、檔案、Ollama、網路的互動都在各層內完成。
export { AI_ENGINE_MODULE_ID } from './data/local/localPaths';
export { readModuleStatus } from './data/local/registryStore';
export { loadActiveRules } from './data/local/moduleFiles';
export { detectNativeArch, detectHardware } from './data/local/system';
export { LOCAL_RULES_VERSION } from '@judge/core';
export { jobStatus, type StageEvent } from './services/jobBus';
export { planForUi, setSkipAi, type PlanChoice, type PlanOption } from './services/planService';
export { installAiEngineModule, type InstallOptions } from './services/aiEngineInstall';
export { installCrawlerModuleForApp } from './services/crawlerInstall';
export { diagnose, exportDiagnosticReport } from './services/diagnosticsService';
export { runRepair } from './services/repairService';
export { localBackendIfReady } from './services/localBackend';
