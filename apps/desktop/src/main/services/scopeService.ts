// 範圍整理服務：法名確認（有候選時請使用者選）→ 法條沿革與現行條文 → 篩選判決（有上限的重試，AI 可提議關鍵字）
// → 逐案 AI 分析（單案失敗不中止，AI 可關閉改為傳統篩選）→ 綜合分析 → 存入檔案管理。
// 每一步都寫入流程紀錄（PipelineTrace），供畫面的說明視窗顯示實際經過的處理。
import {
  jurisdictionRegistry, buildScopeTable, CourtClient, analyzeCase, synthesizeScope, proposeQueries,
  currentTextForCitations, settleEach, newTrace, addStep, explainTrace, runQueryRounds, buildLawContext, buildClarifyOptions,
  type CaseAnalysis, type ClarifyOption, type CurrentLaw, type HistoryArticle, type PipelineTrace, type ScopeRow, type ScopeSynthesis, type AiComplete,
  type TraceExplanation,
} from '@judge/core';
import type { ScopeSheet } from '../scopeExporters';
import { library } from '../data/local/libraryAccess';
import { resolveStatuteOrCandidates, lawHistoryFor, currentLawFor } from '../data/cloud/lawRepo';
import { cachedDetail } from '../data/cloud/courtRepo';
import { splitStatuteLine, rowCites } from './statuteInput';

export const SCOPE_MAX_ROUNDS = 3;

export interface ScopeRunArgs {
  statutes: string[];
  yearFrom?: number;
  yearTo?: number;
  maxItems: number;
  /** 法院管轄區；未指定為台灣司法院。法規名稱確認與法條沿革目前只支援台灣法規資料庫。 */
  jurisdiction?: string;
  /** AI 來源：auto、local、cloud（見 aiRepo）。 */
  ai?: string;
  /** 是否進行 AI 分析（逐案與綜合）。關閉時只做傳統篩選（issue #4 第 5 點）。預設開啟。 */
  aiAnalysis?: boolean;
}

export interface ScopeProgress {
  statute: string;
  done: number;
  total: number;
  phase: string;
}

export interface ScopeRunDone {
  status: 'done';
  sheets: ScopeSheet[];
  notes: string[];
  trace: PipelineTrace;
  explanation: TraceExplanation;
}

/** 法名有多個候選：回傳選項，畫面讓使用者選；選定後以選項文字重新執行（issue #4 第 3 點）。 */
export interface ScopeRunAsk {
  status: 'ask';
  /** 需要使用者選擇的那一行（原始輸入）。 */
  statuteLine: string;
  question: string;
  options: ClarifyOption[];
  notes: string[];
  trace: PipelineTrace;
  explanation: TraceExplanation;
}

export type ScopeRunResult = ScopeRunDone | ScopeRunAsk;

/** 依判決引用的條文，從現行條文取出對應段落；找不到時回傳 undefined（不猜）。 */
export function currentTextFor(law: CurrentLaw, cited: string[]): string | undefined {
  return currentTextForCitations(law, cited);
}

export async function runScope(
  args: ScopeRunArgs,
  ai: AiComplete | null,
  onProgress: (p: ScopeProgress) => void,
): Promise<ScopeRunResult> {
  const sheets: ScopeSheet[] = [];
  const notes: string[] = [];
  const trace = newTrace('範圍整理');
  const client = new CourtClient();
  const aiOn = args.aiAnalysis !== false && ai !== null;
  if (args.aiAnalysis !== false && ai === null) notes.push('未設定可用的 AI，已改為傳統篩選（不做 AI 分析與自動換關鍵字）。');
  addStep(trace, {
    stage: 'AI 分析設定', module: 'rule', input: aiOn ? '啟用' : '關閉',
    output: aiOn ? '逐案與綜合分析、自動換關鍵字皆啟用' : '只做傳統篩選',
    decision: 'pass', reason: aiOn ? '使用者啟用 AI 分析' : '使用者關閉 AI 分析或沒有可用的 AI',
  });

  for (const line of args.statutes) {
    const { name, citation } = splitStatuteLine(line);
    onProgress({ statute: name, done: 0, total: 1, phase: '確認法名與法條沿革' });
    // 只有支援法規查詢的管轄區（台灣）才做法名確認與法條沿革；其他管轄區以輸入的名稱直接搜尋。
    const lookup = jurisdictionRegistry.get(args.jurisdiction).statuteLookup;
    let statute: { name: string; pcode: string; note?: string } = { name, pcode: '' };
    if (lookup) {
      const r = await resolveStatuteOrCandidates(name);
      if (r.status === 'candidates') {
        const options = buildClarifyOptions(r.candidates.map((c) => ({ label: c, description: '全國法規資料庫的正式法名' })));
        addStep(trace, { stage: '確認法名', module: 'rule', input: name, output: `候選：${r.candidates.join('、')}`, decision: 'ask', reason: '法名有多個候選，請使用者選擇' });
        return {
          status: 'ask', statuteLine: line, question: `「${name}」有多個可能的法規，請選擇要整理的正式法名：`,
          options, notes, trace, explanation: explainTrace(trace),
        };
      }
      statute = { name: r.name, pcode: r.pcode, note: r.note };
    }
    if (statute.note) notes.push(statute.note);
    addStep(trace, { stage: '確認法名', module: 'rule', input: name, output: statute.name, decision: 'pass', reason: statute.note ?? '法名確認完成' });

    const lawHistory: HistoryArticle[] = lookup ? await lawHistoryFor(statute.name) : [];
    // 現行條文（issue #4 第 4 點）：取得失敗只記錄，AI 改依判決原文判讀。
    let currentLaw: CurrentLaw | null = null;
    if (lookup && statute.pcode) {
      try {
        currentLaw = await currentLawFor(statute.pcode);
        addStep(trace, { stage: '讀入法規現行條文', module: 'rule', input: statute.name, output: `${currentLaw.articles.length} 條`, decision: 'pass', reason: '現行條文已讀入，篩選與分析時對照' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notes.push(`「${statute.name}」現行條文取得失敗，AI 只依判決原文判讀：${msg}`);
        addStep(trace, { stage: '讀入法規現行條文', module: 'rule', input: statute.name, output: '失敗', decision: 'skip', reason: msg });
      }
    }
    const lawContext = buildLawContext({ statuteName: statute.name, law: currentLaw, history: lawHistory }).text;

    // 篩選判決：第一輪用法名；結果不足時（AI 啟用時）由 AI 依法規上下文提議新關鍵字，最多 SCOPE_MAX_ROUNDS 輪。
    const search = async (q: string): Promise<ScopeRow[]> => {
      const rows = await buildScopeTable({
        statute: statute.name,
        searchQuery: q,
        yearFrom: args.yearFrom,
        yearTo: args.yearTo,
        maxItems: args.maxItems,
        client,
        jurisdiction: args.jurisdiction,
        lawHistory,
        onProgress: (done, total) => onProgress({ statute: statute.name, done, total, phase: '篩選判決' }),
      });
      return citation ? rows.filter((r) => rowCites(r, citation)) : rows;
    };
    const rounds = await runQueryRounds<ScopeRow>({
      feature: '篩選判決',
      trace,
      module: aiOn ? 'ai' : 'rule',
      initialQueries: [statute.name],
      maxRounds: aiOn ? SCOPE_MAX_ROUNDS : 1,
      search,
      keyOf: (r) => r.id,
      onError: (q, err) => notes.push(`搜尋「${q}」失敗：${err instanceof Error ? err.message : String(err)}`),
      propose: async ({ tried, kept, round }) => {
        if (!ai || !aiOn) return { unclear: false, queries: [], reason: '未使用 AI，不自動換關鍵字' };
        return proposeQueries(ai, { request: `${statute.name}（判決中確實引用該法規）`, tried, keptCount: kept.length, round, lawContext });
      },
    });
    if (rounds.status === 'ask') {
      const options = rounds.options;
      return {
        status: 'ask', statuteLine: line, question: rounds.question, options, notes, trace, explanation: explainTrace(trace),
      };
    }
    if (rounds.status === 'capped') notes.push(`「${statute.name}」${rounds.advice}`);
    let rows: ScopeRow[] = rounds.items;
    if (args.yearFrom || args.yearTo) {
      rows = rows.filter((r) => {
        const y = r.dateIso ? Number(r.dateIso.slice(0, 4)) : null;
        if (y === null) return true;
        if (args.yearFrom && y < args.yearFrom) return false;
        if (args.yearTo && y > args.yearTo) return false;
        return true;
      });
    }
    addStep(trace, { stage: '整理篩選結果', module: 'rule', input: `${statute.name}${citation ? `（${citation}）` : ''}`, output: `${rows.length} 筆`, decision: 'pass', reason: '只保留判決中確實引用該法規的案件' });

    let analyses: CaseAnalysis[] = [];
    let synthesis: ScopeSynthesis | null = null;
    if (aiOn && ai) {
      // 逐案分析：單一案件失敗只記錄，其餘照常完成（issue #4 第 1 點）。
      const { results, failures } = await settleEach(
        rows,
        async (row) => {
          const d = await cachedDetail(row.id, client, args.jurisdiction);
          const currentText = currentLaw ? currentTextForCitations(currentLaw, row.citedArticles) : undefined;
          return analyzeCase(ai, statute.name, row, d, { currentText });
        },
        (done, total) => onProgress({ statute: statute.name, done, total, phase: 'AI 逐案分析' }),
      );
      analyses = results;
      for (const f of failures) notes.push(`「${f.item.title}」逐案分析失敗（${f.message}），已保留其他判決。`);
      addStep(trace, { stage: 'AI 逐案分析', module: 'cloud', input: `${rows.length} 筆判決`, output: `成功 ${results.length} 筆，失敗 ${failures.length} 筆`, decision: 'pass', reason: failures.length ? '失敗的案件已記錄，其餘照常生成' : '全部案件分析完成' });

      onProgress({ statute: statute.name, done: 1, total: 1, phase: 'AI 綜合分析' });
      if (analyses.length) {
        try {
          synthesis = await synthesizeScope(ai, statute.name, analyses);
          addStep(trace, { stage: 'AI 綜合分析', module: 'cloud', input: `${analyses.length} 則逐案分析`, output: '完成', decision: 'pass', reason: '跨案綜合完成，放行生成' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          notes.push(`「${statute.name}」綜合分析失敗：${msg}`);
          addStep(trace, { stage: 'AI 綜合分析', module: 'cloud', input: `${analyses.length} 則逐案分析`, output: '失敗', decision: 'skip', reason: msg });
        }
      }
    } else {
      addStep(trace, { stage: 'AI 逐案與綜合分析', module: 'rule', input: `${rows.length} 筆判決`, output: '已關閉，只輸出傳統篩選結果', decision: 'skip', reason: '使用者關閉 AI 分析' });
    }
    sheets.push({ statute: citation ? `${statute.name}${line.trim().slice(name.length)}` : statute.name, rows, analyses, synthesis });
  }
  const total = sheets.reduce((n, sh) => n + sh.rows.length, 0);
  await library().add({
    kind: 'scope',
    title: `範圍整理：${args.statutes.join('、')}`,
    summary: `${sheets.length} 部法規，共 ${total} 筆`,
    payload: { sheets, yearFrom: args.yearFrom, yearTo: args.yearTo, trace },
  });
  return { status: 'done', sheets, notes, trace, explanation: explainTrace(trace) };
}
