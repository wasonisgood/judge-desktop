// 有上限的查詢輪次（issue #4 第 1、2、3 點）：
// - 每一輪的命中結果都保留（不合不是全棄）；
// - 結果不足時由 propose 提議新的關鍵字，最多 maxRounds 輪；
// - 語意不清（propose 回報 unclear）時停下來，提供選項，最後一個選項是自行更正後再試；
// - 達到上限時輸出目前已找到的結果，並說明狀況與建議。
import { addStep, type PipelineTrace, type TraceModule } from './trace';

export interface ClarifyOption {
  id: string;
  label: string;
  description: string;
}

/** 最後一個選項一律是「自行更正理解後再試」。 */
export const MANUAL_OPTION: ClarifyOption = {
  id: 'manual',
  label: '自行輸入更正後再試',
  description: '我會依你更正的文字重新執行，不採用 AI 的理解。',
};

export function buildClarifyOptions(candidates: { label: string; description: string }[]): ClarifyOption[] {
  const opts = candidates.slice(0, 3).map((c, i) => ({ id: `candidate-${i + 1}`, ...c }));
  return [...opts, MANUAL_OPTION];
}

export interface ProposalUnclear {
  unclear: true;
  question: string;
  options: ClarifyOption[];
}

export interface ProposalQueries {
  unclear: false;
  queries: string[];
  reason: string;
}

export type QueryProposal = ProposalQueries | ProposalUnclear;

export interface QueryRoundsOptions<T> {
  feature: string;
  trace: PipelineTrace;
  module: TraceModule;
  initialQueries: string[];
  maxRounds: number;
  /** 執行一組關鍵字，回傳命中項目。 */
  search: (query: string) => Promise<T[]>;
  /** 取得項目的唯一 id。 */
  keyOf: (item: T) => string;
  /** 目前已保留的結果足以輸出時回傳 true，預設：有任一筆就停止。 */
  sufficient?: (kept: T[]) => boolean;
  /** 依已嘗試的關鍵字與結果提議下一組關鍵字；回傳 unclear 時停下來詢問。 */
  propose: (state: { tried: string[]; kept: T[]; round: number }) => Promise<QueryProposal>;
  /** 搜尋失敗時要不要中止整個流程（預設：記錄為略過並繼續）。 */
  onError?: (query: string, err: unknown) => void;
}

export type QueryRoundsResult<T> =
  | { status: 'done'; items: T[]; tried: string[] }
  | { status: 'capped'; items: T[]; tried: string[]; advice: string }
  | { status: 'ask'; items: T[]; tried: string[]; question: string; options: ClarifyOption[] };

export async function runQueryRounds<T>(opts: QueryRoundsOptions<T>): Promise<QueryRoundsResult<T>> {
  const kept = new Map<string, T>();
  const tried: string[] = [];
  const sufficient = opts.sufficient ?? ((items: T[]) => items.length > 0);
  let queries = opts.initialQueries.map((q) => q.trim()).filter(Boolean);

  for (let round = 1; round <= opts.maxRounds; round++) {
    const hitsThisRound: string[] = [];
    for (const q of queries) {
      tried.push(q);
      try {
        const hits = await opts.search(q);
        for (const h of hits) if (!kept.has(opts.keyOf(h))) kept.set(opts.keyOf(h), h);
        hitsThisRound.push(`「${q}」${hits.length} 筆`);
      } catch (err) {
        opts.onError?.(q, err);
        hitsThisRound.push(`「${q}」失敗`);
      }
    }
    const items = [...kept.values()];
    const enough = sufficient(items);
    addStep(opts.trace, {
      stage: `第 ${round} 輪${opts.feature}`,
      module: opts.module,
      input: queries.join('、'),
      output: `${hitsThisRound.join('；')}；累計保留 ${items.length} 筆`,
      decision: enough ? 'pass' : round < opts.maxRounds ? 'retry' : 'capped',
      reason: enough ? '已有可用結果，放行生成' : round < opts.maxRounds ? '結果不足，改用提議的關鍵字再查' : '已達重試上限',
    });
    if (enough) return { status: 'done', items, tried };
    if (round === opts.maxRounds) break;

    const proposal = await opts.propose({ tried: [...tried], kept: items, round });
    if (proposal.unclear) {
      addStep(opts.trace, {
        stage: '語意確認',
        module: opts.module,
        input: `已嘗試：${tried.join('、')}`,
        output: proposal.question,
        decision: 'ask',
        reason: '使用者需求語意不清，停下來請使用者選擇',
      });
      return { status: 'ask', items, tried, question: proposal.question, options: proposal.options };
    }
    queries = proposal.queries.map((q) => q.trim()).filter((q) => q && !tried.includes(q));
    if (queries.length === 0) {
      addStep(opts.trace, {
        stage: '提議新關鍵字',
        module: opts.module,
        input: '',
        output: '沒有新的關鍵字可以嘗試',
        decision: 'capped',
        reason: '提議的關鍵字都已嘗試過',
      });
      break;
    }
  }

  const items = [...kept.values()];
  return {
    status: 'capped',
    items,
    tried,
    advice: items.length
      ? `已嘗試 ${tried.length} 組關鍵字，目前保留 ${items.length} 筆。可以縮小範圍、改用更具體的字詞，或手動輸入判決網址。`
      : `已嘗試 ${tried.length} 組關鍵字仍沒有結果。建議換用更上位的字詞、確認法規名稱，或手動輸入判決網址。`,
  };
}
