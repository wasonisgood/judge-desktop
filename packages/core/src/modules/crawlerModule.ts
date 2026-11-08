// 爬取模組的安裝流程：檢查網路與司法院網域 → 實際抓一筆公開資料做煙霧測試 → 註冊。
// 與 AI 引擎模組完全分開：各自有安裝流程、版本與狀態，互不影響。
import { runNetworkProbe, type ProbeSummary } from '../local/probe';

export const CRAWLER_STAGES = ['checkNetwork', 'smokeFetch', 'register'] as const;
export type CrawlerStage = (typeof CRAWLER_STAGES)[number];

export interface CrawlerModuleDeps {
  probe?: () => Promise<ProbeSummary>;
  /** 實際抓取一筆公開資料（桌面端注入 CourtClient）。回傳空值或空陣列視為失敗。 */
  smokeFetch: () => Promise<unknown>;
  register: () => void;
}

export interface CrawlerInstallResult {
  ok: boolean;
  completed: CrawlerStage[];
  failedAt?: CrawlerStage;
  error?: string;
}

export async function installCrawlerModule(deps: CrawlerModuleDeps): Promise<CrawlerInstallResult> {
  const completed: CrawlerStage[] = [];
  const steps: Record<CrawlerStage, () => Promise<void>> = {
    checkNetwork: async () => {
      const p = await (deps.probe ?? (() => runNetworkProbe()))();
      if (!p.ready) throw new Error(p.messages.join('；'));
    },
    smokeFetch: async () => {
      const r = await deps.smokeFetch();
      if (r === null || r === undefined || (Array.isArray(r) && r.length === 0)) {
        throw new Error('煙霧測試沒有取得任何資料');
      }
    },
    register: async () => {
      deps.register();
    },
  };
  for (const stage of CRAWLER_STAGES) {
    try {
      await steps[stage]();
      completed.push(stage);
    } catch (e: any) {
      // 任一步失敗即停止；未註冊就不會被 router 使用。
      return { ok: false, completed, failedAt: stage, error: e?.message ?? String(e) };
    }
  }
  return { ok: true, completed };
}
