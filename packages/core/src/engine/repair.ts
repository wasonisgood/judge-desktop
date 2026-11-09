// 修復步驟表：依錯誤代碼給出「可執行的修復動作」與「需要使用者自己處理的事」。
// 每個動作都有固定的 id，桌面端依 id 對應到真正的程式。
import type { EngineErrorCode } from './errors';

export type RepairActionId =
  | 'retry'
  | 'restart-service'
  | 'redownload-installer'
  | 'reinstall-engine'
  | 'repull-models'
  | 'reregister'
  | 'free-disk-space'
  | 'run-as-user'
  | 'check-network-vpn';

export interface RepairPlan {
  code: EngineErrorCode;
  /** 依序嘗試的自動修復動作。 */
  automatic: RepairActionId[];
  /** 需要使用者自己處理的說明（繁體中文）。 */
  userSteps: string[];
}

const TABLE: Record<EngineErrorCode, { automatic: RepairActionId[]; userSteps: string[] }> = {
  PREREQUISITE_MISSING: { automatic: ['retry'], userSteps: ['缺少系統工具（tar 或 df）。請依上方的安裝指令安裝後，再按「重試」。'] },
  DISK_FULL: { automatic: [], userSteps: ['磁碟空間不足，請清出至少 15 GB 後再按「重試」。'] },
  PERMISSION: { automatic: [], userSteps: ['權限不足。請以一般使用者身分重新開啟本程式，或確認安裝資料夾沒有被防毒軟體鎖定。'] },
  NETWORK: { automatic: ['retry'], userSteps: ['網路連線不穩。請確認網路後再按「重試」（會從中斷處續傳）。'] },
  TIMEOUT: { automatic: ['retry'], userSteps: ['連線逾時。若使用 VPN，請嘗試切換節點後重試。'] },
  SERVICE_DOWN: { automatic: ['restart-service', 'reregister'], userSteps: ['本地服務沒有回應。若重新啟動仍失敗，請重新開機後再試。'] },
  INSTALLER_FAILED: { automatic: ['redownload-installer', 'reinstall-engine'], userSteps: ['安裝程式失敗。若持續失敗，請把失敗摘要傳給開發者。'] },
  SIGNATURE_INVALID: { automatic: ['redownload-installer'], userSteps: ['安裝檔的數位簽章無法驗證，為安全起見已停止安裝。請確認網路環境未被竄改後再試。'] },
  HASH_MISMATCH: { automatic: ['redownload-installer'], userSteps: ['下載檔案不完整，已自動刪除並重新下載。'] },
  PULL_FAILED: { automatic: ['repull-models'], userSteps: ['模型下載失敗，已會自動續傳重試。'] },
  UNKNOWN: { automatic: ['retry'], userSteps: ['發生未知錯誤。可按「重試」；若仍失敗，請把失敗摘要傳給開發者。'] },
};

export function repairPlan(code: EngineErrorCode): RepairPlan {
  return { code, ...TABLE[code] };
}
