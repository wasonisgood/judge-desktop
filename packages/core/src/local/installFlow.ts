// 本地 AI 安裝精靈的流程狀態機。每個步驟由呼叫端注入實作，流程本身只負責順序、停止與錯誤紀錄。
// 規則：任一步失敗就停止並回報失敗階段；只有全部步驟成功，呼叫端才會註冊本地後端。

export const INSTALL_STAGES = [
  'consent', // 使用者按下同意
  'checkSystem', // 硬體與磁碟檢查
  'checkNetwork', // 網路與司法院網域檢查
  'confirmPlan', // 顯示建議方案，使用者確認
  'installEngine', // 安裝 Ollama 服務
  'verifyEngine', // 確認服務可回應
  'pullModels', // 拉取模型
  'smokeTest', // 每個模型實際生成一次測試
  'register', // 註冊到 router
] as const;

export type InstallStage = (typeof INSTALL_STAGES)[number];

export type InstallSteps = Partial<Record<InstallStage, (ctx: Record<string, any>) => Promise<unknown> | unknown>>;

export interface InstallResult {
  ok: boolean;
  /** 已完成的階段（依序）。 */
  completed: InstallStage[];
  /** 失敗或取消時的階段。 */
  failedAt?: InstallStage;
  error?: string;
  /** 每個階段的回傳值。 */
  context: Record<string, any>;
}

/**
 * 依序執行步驟。
 * - 任一步拋錯 → 停止，ok=false，failedAt 為該階段。
 * - confirmPlan 回傳 { confirmed: false } → 停止，視為使用者取消（不是系統錯誤）。
 * - 缺少某階段的實作 → 停止並回報，避免靜默略過安全檢查。
 */
export async function runInstallFlow(
  steps: InstallSteps,
  onStage?: (stage: InstallStage, status: 'start' | 'done' | 'failed') => void,
): Promise<InstallResult> {
  const ctx: Record<string, any> = {};
  const completed: InstallStage[] = [];
  for (const stage of INSTALL_STAGES) {
    const fn = steps[stage];
    if (!fn) return { ok: false, completed, failedAt: stage, error: `缺少步驟實作：${stage}`, context: ctx };
    onStage?.(stage, 'start');
    try {
      const out = await fn(ctx);
      if (stage === 'confirmPlan' && out && (out as { confirmed?: boolean }).confirmed === false) {
        onStage?.(stage, 'failed');
        return { ok: false, completed, failedAt: stage, error: '使用者取消安裝', context: ctx };
      }
      ctx[stage] = out;
      completed.push(stage);
      onStage?.(stage, 'done');
    } catch (e: any) {
      onStage?.(stage, 'failed');
      return { ok: false, completed, failedAt: stage, error: e?.message ?? String(e), context: ctx };
    }
  }
  return { ok: true, completed, context: ctx };
}
