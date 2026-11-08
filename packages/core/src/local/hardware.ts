// 本地 AI 硬體分級。規則表（EngineRules）可由「AI 引擎模組」的 rules.json 覆寫，不必重新安裝應用程式。
// 輸入為系統檢查結果，輸出為建議的分級與模型配置。純函式，不做任何系統呼叫。

export interface HardwareInfo {
  /** 實體記憶體（GB）。 */
  ramGB: number;
  /** 安裝磁碟可用空間（GB）。 */
  freeDiskGB: number;
  /** 獨立顯示卡顯示記憶體（GB）；沒有獨立顯卡為 0。 */
  vramGB: number;
  /** 顯卡廠商。 */
  gpuVendor: 'nvidia' | 'amd' | 'intel' | 'none';
}

export type LocalTier = 'none' | 'light' | 'standard' | 'heavy';

export interface LocalPlan {
  tier: LocalTier;
  judgmentModel: string | null;
  chatModel: string | null;
  installBoth: boolean;
  requiredDiskGB: number;
  reasons: string[];
}

export interface TierRule {
  judgment: string;
  chat: string;
  diskGB: number;
  minRamGB: number;
}

export interface EngineRules {
  schemaVersion: 1;
  rulesVersion: number;
  minDiskGB: number;
  tiers: { light: TierRule; standard: TierRule; heavy: TierRule };
  /** 同時安裝兩個模型所需的最低獨立顯存（GB）。 */
  dualModelMinVramGB: number;
  /** 本地服務引擎的最低版本；既有服務低於此版本就不沿用。 */
  minEngineVersion: string;
}

/** 內建規則（模組規則表不存在或無效時使用）。 */
export const BUILTIN_RULES: EngineRules = {
  schemaVersion: 1,
  rulesVersion: 1,
  minDiskGB: 10,
  tiers: {
    light: { judgment: 'qwen2.5:3b', chat: 'qwen2.5:3b', diskGB: 3, minRamGB: 8 },
    standard: { judgment: 'qwen2.5:7b', chat: 'qwen2.5:7b', diskGB: 6, minRamGB: 16 },
    heavy: { judgment: 'qwen2.5:14b', chat: 'qwen2.5:7b', diskGB: 14, minRamGB: 32 },
  },
  dualModelMinVramGB: 8,
  minEngineVersion: '0.40.0',
};

/** 規則版本號（給失敗回報使用）。 */
export const LOCAL_RULES_VERSION = BUILTIN_RULES.rulesVersion;

/** 模型對照表（與 BUILTIN_RULES 同步；保留給既有程式與測試使用）。 */
export const MODEL_TABLE = BUILTIN_RULES.tiers;

/** 驗證規則表結構；通過才會被使用。 */
export function validateRules(x: unknown): { ok: true; rules: EngineRules } | { ok: false; error: string } {
  const r = x as EngineRules;
  if (!r || typeof r !== 'object') return { ok: false, error: '規則表不是物件' };
  if (r.schemaVersion !== 1) return { ok: false, error: `不支援的 schemaVersion：${(r as any).schemaVersion}` };
  if (!Number.isInteger(r.rulesVersion) || r.rulesVersion < 1) return { ok: false, error: 'rulesVersion 無效' };
  if (!(r.minDiskGB > 0)) return { ok: false, error: 'minDiskGB 無效' };
  if (!(r.dualModelMinVramGB >= 0)) return { ok: false, error: 'dualModelMinVramGB 無效' };
  if (typeof r.minEngineVersion !== 'string' || !/^\d+\.\d+(\.\d+)?$/.test(r.minEngineVersion)) return { ok: false, error: 'minEngineVersion 無效' };
  for (const k of ['light', 'standard', 'heavy'] as const) {
    const t = r.tiers?.[k];
    if (!t || typeof t.judgment !== 'string' || !t.judgment || typeof t.chat !== 'string' || !t.chat) {
      return { ok: false, error: `tiers.${k} 缺少模型名稱` };
    }
    if (!(t.diskGB > 0) || !(t.minRamGB > 0)) return { ok: false, error: `tiers.${k} 數值無效` };
  }
  if (!(r.tiers.light.minRamGB < r.tiers.standard.minRamGB && r.tiers.standard.minRamGB < r.tiers.heavy.minRamGB)) {
    return { ok: false, error: '記憶體門檻必須 light < standard < heavy' };
  }
  return { ok: true, rules: r };
}

/** 依硬體與規則決定本地 AI 方案。不符合最低需求時回傳 tier=none（只用雲端）。 */
export function planLocalAI(hw: HardwareInfo, rules: EngineRules = BUILTIN_RULES): LocalPlan {
  const reasons: string[] = [];
  const none = (why: string): LocalPlan => {
    reasons.push(why);
    return { tier: 'none', judgmentModel: null, chatModel: null, installBoth: false, requiredDiskGB: 0, reasons };
  };
  if (hw.freeDiskGB < rules.minDiskGB) {
    return none(`磁碟可用空間 ${hw.freeDiskGB} GB 低於 ${rules.minDiskGB} GB，無法安裝本地模型`);
  }
  let tier: Exclude<LocalTier, 'none'>;
  if (hw.ramGB >= rules.tiers.heavy.minRamGB) {
    tier = 'heavy';
    reasons.push(`記憶體 ${hw.ramGB} GB，達到重度分級門檻（${rules.tiers.heavy.minRamGB} GB）`);
  } else if (hw.ramGB >= rules.tiers.standard.minRamGB) {
    tier = 'standard';
    reasons.push(`記憶體 ${hw.ramGB} GB，達到標準分級門檻（${rules.tiers.standard.minRamGB} GB）`);
  } else if (hw.ramGB >= rules.tiers.light.minRamGB) {
    tier = 'light';
    reasons.push(`記憶體 ${hw.ramGB} GB，屬於輕量分級（${rules.tiers.light.minRamGB} GB 以上）`);
  } else {
    return none(`記憶體 ${hw.ramGB} GB 低於 ${rules.tiers.light.minRamGB} GB，無法本地執行，改用雲端`);
  }

  const m = rules.tiers[tier];
  const installBoth = tier === 'heavy' && hw.vramGB >= rules.dualModelMinVramGB && hw.gpuVendor !== 'none';
  if (tier === 'heavy' && !installBoth) reasons.push(`沒有足夠顯存（需 ${rules.dualModelMinVramGB} GB 以上獨立顯卡），只安裝精讀模型`);
  // 雙模型：回答模型用 heavy 分級的 chat 模型（較輕），精讀用 heavy 的 judgment 模型。
  const chatModel = installBoth ? rules.tiers.heavy.chat : m.judgment;
  // 兩個模型時，精讀模型（heavy）與回答模型（standard）的磁碟需求相加。
  const requiredDiskGB = installBoth ? rules.tiers.heavy.diskGB + rules.tiers.standard.diskGB : m.diskGB;
  if (requiredDiskGB > hw.freeDiskGB) {
    return none(`需要約 ${requiredDiskGB} GB，磁碟可用 ${hw.freeDiskGB} GB 不足，改用雲端`);
  }
  return { tier, judgmentModel: m.judgment, chatModel, installBoth, requiredDiskGB, reasons };
}
