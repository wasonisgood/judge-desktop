// 量化圖表模組（issue #8）的安裝流程：不需下載，只做內建檔案檢查與自我檢查，通過後才註冊為 ready。
// 與爬取模組相同的規則：任一階段失敗即停止，未註冊就不會被使用。
export const CHART_STAGES = ['checkBundle', 'selfCheck', 'register'] as const;
export type ChartStage = (typeof CHART_STAGES)[number];

export interface ChartModuleDeps {
  /** 內建模組資料夾與版本描述檔是否存在、版本欄位是否有效（桌面端注入）。 */
  checkBundle: () => void | Promise<void>;
  /** 用固定樣本實際跑一次圖表組裝，確認計算與繪圖可用（桌面端注入）。 */
  selfCheck: () => void | Promise<void>;
  /** 註冊為可用（桌面端寫入模組狀態）。 */
  register: () => void | Promise<void>;
}

export interface ChartInstallResult {
  ok: boolean;
  completed: ChartStage[];
  failedAt?: ChartStage;
  error?: string;
}

export async function installChartModule(deps: ChartModuleDeps): Promise<ChartInstallResult> {
  const completed: ChartStage[] = [];
  for (const stage of CHART_STAGES) {
    try {
      if (stage === 'checkBundle') await deps.checkBundle();
      else if (stage === 'selfCheck') await deps.selfCheck();
      else await deps.register();
      completed.push(stage);
    } catch (e: any) {
      return { ok: false, completed, failedAt: stage, error: e?.message ?? String(e) };
    }
  }
  return { ok: true, completed };
}
