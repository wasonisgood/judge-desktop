// 範圍整理服務：依法規逐一確認法名、取得法條沿革與現行條文、篩選判決、逐案 AI 分析（單案失敗不中止）、綜合分析，最後存入檔案管理。
// 每一步都寫入流程紀錄（PipelineTrace），供畫面的說明視窗顯示實際經過的處理。
import {
  jurisdictionRegistry, buildScopeTable, CourtClient, analyzeCase, synthesizeScope,
  currentTextForCitations, settleEach, newTrace, addStep, explainTrace,
  type CaseAnalysis, type CurrentLaw, type PipelineTrace, type ScopeRow, type ScopeSynthesis, type AiComplete, type TraceExplanation,
} from '@judge/core';
import type { ScopeSheet } from '../scopeExporters';
import { library } from '../data/local/libraryAccess';
import { resolveStatute, lawHistoryFor, currentLawFor } from '../data/cloud/lawRepo';
import { cachedDetail } from '../data/cloud/courtRepo';
import { splitStatuteLine, rowCites } from './statuteInput';

export interface ScopeRunArgs {
  statutes: string[];
  yearFrom?: number;
  yearTo?: number;
  maxItems: number;
  /** 法院管轄區；未指定為台灣司法院。法規名稱確認與法條沿革目前只支援台灣法規資料庫。 */
  jurisdiction?: string;
  /** AI 來源：auto、local、cloud（見 aiRepo）。 */
  ai?: string;
}

export interface ScopeProgress {
  statute: string;
  done: number;
  total: number;
  phase: string;
}

export interface ScopeRunResult {
  sheets: ScopeSheet[];
  notes: string[];
  trace: PipelineTrace;
  explanation: TraceExplanation;
}

export async function runScope(
  args: ScopeRunArgs,
  ai: AiComplete,
  onProgress: (p: ScopeProgress) => void,
): Promise<ScopeRunResult> {
  const sheets: ScopeSheet[] = [];
  const notes: string[] = [];
  const trace = newTrace('範圍整理');
  const client = new CourtClient();
  for (const line of args.statutes) {
    const { name, citation } = splitStatuteLine(line);
    onProgress({ statute: name, done: 0, total: 1, phase: '確認法名與法條沿革' });
    // 只有支援法規查詢的管轄區（台灣）才做法名確認與法條沿革；其他管轄區以輸入的名稱直接搜尋。
    const lookup = jurisdictionRegistry.get(args.jurisdiction).statuteLookup;
    const statute = lookup ? await resolveStatute(name) : { name, pcode: '', note: undefined as string | undefined };
    if (statute.note) notes.push(statute.note);
    addStep(trace, { stage: '確認法名', module: 'rule', input: name, output: statute.name, decision: 'pass', reason: statute.note ?? '法名確認完成' });

    const lawHistory = lookup ? await lawHistoryFor(statute.name) : [];
    // 現行條文（issue #4 第 4 點）：取得失敗只記錄，AI 改依判決原文判讀。
    let currentLaw: CurrentLaw | null = null;
    if (lookup && statute.pcode) {
      try {
        currentLaw = await currentLawFor(statute.pcode);
        addStep(trace, { stage: '讀入法規現行條文', module: 'rule', input: statute.name, output: `${currentLaw.articles.length} 條`, decision: 'pass', reason: '現行條文已讀入，分析時對照' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notes.push(`「${statute.name}」現行條文取得失敗，AI 只依判決原文判讀：${msg}`);
        addStep(trace, { stage: '讀入法規現行條文', module: 'rule', input: statute.name, output: '失敗', decision: 'skip', reason: msg });
      }
    }

    let rows: ScopeRow[] = await buildScopeTable({
      statute: statute.name,
      yearFrom: args.yearFrom,
      yearTo: args.yearTo,
      maxItems: args.maxItems,
      client,
      jurisdiction: args.jurisdiction,
      lawHistory,
      onProgress: (done, total) => onProgress({ statute: statute.name, done, total, phase: '篩選判決' }),
    });
    if (citation) rows = rows.filter((r) => rowCites(r, citation));
    addStep(trace, { stage: '篩選確實引用的判決', module: 'rule', input: `${statute.name}${citation ? `（${citation}）` : ''}`, output: `${rows.length} 筆`, decision: 'pass', reason: '只保留判決中確實引用該法規的案件' });

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
    const analyses: CaseAnalysis[] = results;
    for (const f of failures) notes.push(`「${f.item.title}」逐案分析失敗（${f.message}），已保留其他判決。`);
    addStep(trace, { stage: 'AI 逐案分析', module: 'cloud', input: `${rows.length} 筆判決`, output: `成功 ${results.length} 筆，失敗 ${failures.length} 筆`, decision: 'pass', reason: failures.length ? '失敗的案件已記錄，其餘照常生成' : '全部案件分析完成' });

    onProgress({ statute: statute.name, done: 1, total: 1, phase: 'AI 綜合分析' });
    let synthesis: ScopeSynthesis | null = null;
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
    sheets.push({ statute: citation ? `${statute.name}${line.trim().slice(name.length)}` : statute.name, rows, analyses, synthesis });
  }
  const total = sheets.reduce((n, sh) => n + sh.rows.length, 0);
  await library().add({
    kind: 'scope',
    title: `範圍整理：${args.statutes.join('、')}`,
    summary: `${sheets.length} 部法規，共 ${total} 筆`,
    payload: { sheets, yearFrom: args.yearFrom, yearTo: args.yearTo, trace },
  });
  return { sheets, notes, trace, explanation: explainTrace(trace) };
}
