// 本地 AI 硬體分級（規則表，可隨版本更新）。
// 輸入為系統檢查結果，輸出為建議的分級與模型配置。純函式，不做任何系統呼叫。

export interface HardwareInfo {
  /** 實體記憶體（GB）。 */
  ramGB: number;
  /** 安裝磁碟可用空間（GB）。 */
  freeDiskGB: number;
  /** 獨立顯示卡顯示記憶體（GB）；沒有獨立顯卡為 0。 */
  vramGB: number;
  /** 顯卡廠商（nvidia / amd / intel / none）。 */
  gpuVendor: 'nvidia' | 'amd' | 'intel' | 'none';
}

export type LocalTier = 'none' | 'light' | 'standard' | 'heavy';

export interface LocalPlan {
  tier: LocalTier;
  /** 判決精讀／範圍整理用的較重模型；tier 為 none 時為 null。 */
  judgmentModel: string | null;
  /** 回答助理用的較輕模型；只有在能同時安裝兩個時才與 judgmentModel 不同。 */
  chatModel: string | null;
  /** 是否同時安裝兩個模型。 */
  installBoth: boolean;
  /** 安裝前估計需要的磁碟空間（GB）。 */
  requiredDiskGB: number;
  /** 判定理由（給使用者看的說明）。 */
  reasons: string[];
}

/** 規則表版本，每次更新分級規則時遞增。 */
export const LOCAL_RULES_VERSION = 1;

/** 模型對照表：分級 → 模型標籤（Ollama 格式）。 */
export const MODEL_TABLE: Record<Exclude<LocalTier, 'none'>, { judgment: string; chat: string; diskGB: number }> = {
  light: { judgment: 'qwen2.5:3b', chat: 'qwen2.5:3b', diskGB: 3 },
  standard: { judgment: 'qwen2.5:7b', chat: 'qwen2.5:7b', diskGB: 6 },
  heavy: { judgment: 'qwen2.5:14b', chat: 'qwen2.5:7b', diskGB: 14 },
};

const MIN_DISK_GB = 10;

/** 依硬體資訊決定本地 AI 方案。不符合最低需求時回傳 tier=none（只用雲端）。 */
export function planLocalAI(hw: HardwareInfo): LocalPlan {
  const reasons: string[] = [];
  if (hw.freeDiskGB < MIN_DISK_GB) {
    reasons.push(`磁碟可用空間 ${hw.freeDiskGB} GB 低於 ${MIN_DISK_GB} GB，無法安裝本地模型`);
    return { tier: 'none', judgmentModel: null, chatModel: null, installBoth: false, requiredDiskGB: 0, reasons };
  }
  let tier: LocalTier;
  if (hw.ramGB >= 32) {
    tier = 'heavy';
    reasons.push(`記憶體 ${hw.ramGB} GB，達到重度分級門檻（32 GB）`);
  } else if (hw.ramGB >= 16) {
    tier = 'standard';
    reasons.push(`記憶體 ${hw.ramGB} GB，達到標準分級門檻（16 GB）`);
  } else if (hw.ramGB >= 8) {
    tier = 'light';
    reasons.push(`記憶體 ${hw.ramGB} GB，屬於輕量分級（8 GB 以上）`);
  } else {
    reasons.push(`記憶體 ${hw.ramGB} GB 低於 8 GB，無法本地執行，改用雲端`);
    return { tier: 'none', judgmentModel: null, chatModel: null, installBoth: false, requiredDiskGB: 0, reasons };
  }

  const m = MODEL_TABLE[tier];
  // 只有重度分級且具備獨立顯卡（≥ 8 GB VRAM）時，才同時安裝兩個模型。
  const installBoth = tier === 'heavy' && hw.vramGB >= 8 && hw.gpuVendor !== 'none';
  if (tier === 'heavy' && !installBoth) reasons.push('沒有足夠顯存（需 8 GB 以上獨立顯卡），只安裝精讀模型');
  const chatModel = installBoth ? m.chat : m.judgment;
  // 兩個模型時，精讀模型（heavy）與回答模型（standard）的磁碟需求相加。
  const requiredDiskGB = installBoth ? MODEL_TABLE.heavy.diskGB + MODEL_TABLE.standard.diskGB : m.diskGB;
  if (requiredDiskGB > hw.freeDiskGB) {
    reasons.push(`需要約 ${requiredDiskGB} GB，磁碟可用 ${hw.freeDiskGB} GB 不足，改用雲端`);
    return { tier: 'none', judgmentModel: null, chatModel: null, installBoth: false, requiredDiskGB: 0, reasons };
  }
  return { tier, judgmentModel: m.judgment, chatModel, installBoth, requiredDiskGB, reasons };
}
