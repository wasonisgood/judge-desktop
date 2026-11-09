// 常數：流程步驟、安裝階段、排除問題的分組與修復名稱、模組名稱與狀態。
(function (WZ) {
  'use strict';

  WZ.ORDER_STEPS = ['check', 'choose', 'agree', 'install', 'done'];

  WZ.STAGES = [
    ['checkSystem', '檢查電腦'], ['checkNetwork', '檢查網路與司法院連線'], ['decideEngine', '判斷既有服務'],
    ['installEngine', '下載並校驗引擎'], ['startService', '啟動本地服務'], ['verifyEngine', '確認服務版本'],
    ['pullModels', '下載模型'], ['smokeTest', '測試模型回應'], ['register', '註冊本地 AI']
  ];

  WZ.MARK = { pending: '○', running: '●', done: '✓', failed: '✕', retry: '↻' };
  WZ.STATUS_TEXT = { pending: '等待', running: '進行中', done: '完成', failed: '失敗', retry: '重試中' };

  WZ.GROUPS = [
    ['引擎', ['engine-installed', 'engine-arch', 'engine-file', 'engine-signature']],
    ['服務與模型', ['service', 'models', 'chat']],
    ['磁碟與網路', ['disk', 'net-general', 'net-judicial']],
    ['模組與紀錄', ['module', 'recent-failure']]
  ];
  WZ.FIX_NAMES = {
    retry: '重試安裝', 'restart-service': '重新啟動服務', 'reinstall-engine': '安裝或重新安裝引擎',
    'redownload-installer': '重新下載引擎', 'repull-models': '重新下載模型', reregister: '重新註冊',
    'free-disk-space': '說明', 'check-network-vpn': '說明'
  };
  WZ.TONE = { pass: '通過', warn: '警告', fail: '失敗' };

  WZ.MOD_NAMES = { 'ai-engine': 'AI 引擎模組', crawler: '爬取模組' };
  WZ.MOD_STATUS = {
    'not-installed': ['尚未安裝', ''], installing: ['安裝中', 'warn'], ready: ['已啟用', 'pass'],
    failed: ['安裝失敗', 'fail'], disabled: ['不安裝', 'warn']
  };
})(window.WZ);
