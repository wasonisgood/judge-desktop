// IPC：納入／排除核查（issue #12）。候選判決來自「檔案」中的判決列表或範圍整理，或以新關鍵字重新檢索；
// 執行前先規劃（AI 案件數、呼叫次數、估計費用），確認後才執行。每次執行是獨立的一筆 run，保存在 criteria-runs.json，不覆蓋。
import { ipcMain } from 'electron';
import {
  CourtClient, runCriteria, planRun, estimateCostUsd, reviewRerun, appendRun, compareRuns,
  type CaseInput, type CriteriaRun,
} from '@judge/core';
import { readJson, writeJson } from '../data/local/jsonFile';
import { userPath } from '../data/local/paths';
import { readSettings } from '../data/local/settingsStore';
import { library } from '../data/local/libraryAccess';
import { cachedSearch, cachedDetail } from '../data/cloud/courtRepo';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { buildCriteriaWorkbook } from '../criteriaExporter';
import { autoSaveExport, stamp } from '../services/exportService';
import { withJob, newRunId } from '../services/jobRegistry';
import { safeSend } from '../services/safeSend';
import { toUserError } from '../services/userError';
import { parseCriteriaInput, candidateIdsOf, needsFetch, toCaseInput } from '../services/criteriaLogic';

type FetchSource = { kind: 'library'; id: string } | { kind: 'search'; query: string; maxItems: number };

/** 最近一次讀取的候選判決（只保留一組，放在主程序，不傳給畫面）。 */
interface Prepared {
  prepId: string;
  query: string;
  label: string;
  cases: CaseInput[];
  notes: string[];
}
let prepared: Prepared | null = null;

function requirePrepared(prepId: string): Prepared {
  if (!prepared || prepared.prepId !== prepId) throw new Error('候選判決已更新或已清除，請重新讀取候選判決。');
  return prepared;
}

const runsFile = () => userPath('criteria-runs.json');
const readRuns = () => readJson<CriteriaRun[]>(runsFile(), []);

export function registerCriteriaIpc(): void {
  // 讀取候選判決：列表／範圍整理的判決（已有全文者不重讀），或以新關鍵字重新檢索。逐則讀取、可取消、請求間隔由 CourtClient 控制。
  ipcMain.handle('criteria:fetch', (e, args: { runId: string; source: FetchSource }) =>
    withJob(args.runId, 'criteria', '納入排除核查：讀取候選判決', async (signal) => {
      const src = args.source;
      const summaries = new Map<string, { title?: string; dateIso?: string | null }>();
      let ids: string[];
      let details: Record<string, { meta?: { caseNo?: string | null; title?: string; dateIso?: string | null }; fullText?: string } | undefined> = {};
      let query: string;
      let label: string;
      try {
        if (src.kind === 'library') {
          const item = (await library().list()).find((it) => it.id === src.id);
          if (!item) throw new Error('找不到這筆檔案，請重新整理清單。');
          if (item.kind !== 'list' && item.kind !== 'scope') throw new Error('只能以判決列表或範圍整理的結果作為候選判決。');
          const p = (item.payload && typeof item.payload === 'object' ? item.payload : {}) as Record<string, any>;
          ids = candidateIdsOf(item.kind, p);
          details = p.details ?? {};
          for (const it of Array.isArray(p.items) ? p.items : []) summaries.set(it.id, { title: it.title, dateIso: it.dateIso });
          for (const s of Array.isArray(p.sheets) ? p.sheets : []) {
            for (const r of Array.isArray(s?.rows) ? s.rows : []) summaries.set(r.id, { title: r.title, dateIso: r.dateIso });
          }
          query = String(p.keyword ?? item.title);
          label = item.title;
        } else {
          const q = String(src.query ?? '').trim();
          if (!q) throw new Error('請輸入重新檢索的關鍵字。');
          const items = await cachedSearch(q, Math.min(Math.max(1, Number(src.maxItems) || 20), 100));
          ids = items.map((it) => it.id);
          for (const it of items) summaries.set(it.id, { title: it.title, dateIso: it.dateIso });
          query = q;
          label = `重新檢索：${q}`;
        }
      } catch (err) {
        throw toUserError(err);
      }

      const client = new CourtClient({ signal });
      const cases: CaseInput[] = [];
      const notes: string[] = [];
      let cancelled = false;
      for (let i = 0; i < ids.length; i++) {
        if (signal.aborted) { cancelled = true; break; }
        const id = ids[i];
        safeSend(e.sender, 'criteria:progress', { phase: 'fetch', done: i + 1, total: ids.length });
        if (!needsFetch(id, details)) {
          cases.push(toCaseInput(id, details[id], summaries.get(id)));
          continue;
        }
        try {
          const d = await cachedDetail(id, client);
          cases.push(toCaseInput(id, { meta: d.meta, fullText: d.fullText }, summaries.get(id)));
        } catch (err) {
          if (signal.aborted) { cancelled = true; break; }
          notes.push(`${id}：${toUserError(err).message}`);
          cases.push(toCaseInput(id, undefined, summaries.get(id)));
        }
      }
      if (cancelled) return { cancelled: true, prepId: null, label, query, total: 0, withoutText: 0, notes };
      prepared = { prepId: newRunId(), query, label, cases, notes };
      return {
        cancelled: false,
        prepId: prepared.prepId,
        label,
        query,
        total: cases.length,
        withoutText: cases.filter((c) => !c.fullText.trim()).length,
        notes,
      };
    }));

  // 執行前規劃：只計算，不呼叫 AI。費用只在設定了單價時估計；沒有單價時只回傳次數。
  ipcMain.handle('criteria:plan', async (_e, args: { prepId: string; criteria: unknown }) => {
    const p = requirePrepared(args.prepId);
    const criteria = parseCriteriaInput(args.criteria);
    const plan = planRun(criteria, p.cases);
    const usd = (await readSettings()).aiUsdPerMillion;
    const costUsd = usd !== null && plan.aiCalls > 0 ? estimateCostUsd(plan, usd) : null;
    return { plan, costUsd, usdPerMillion: usd, hasAi: criteria.some((c) => c.method === 'ai'), total: p.cases.length };
  });

  // 執行核查（使用者確認後才會呼叫）。AI 服務錯誤會中止整次執行；取消時不保存。
  ipcMain.handle('criteria:run', (e, args: { runId: string; prepId: string; criteria: unknown; ai?: string }) =>
    withJob(args.runId, 'criteria', '納入排除核查', async (signal) => {
      const p = requirePrepared(args.prepId);
      const criteria = parseCriteriaInput(args.criteria);
      let result;
      try {
        const ai = criteria.some((c) => c.method === 'ai') ? await requireAi(normalizeAiMode(args.ai), signal) : undefined;
        result = await runCriteria(
          { query: p.query, criteria, cases: p.cases },
          { ai, signal, onProgress: (done, total) => safeSend(e.sender, 'criteria:progress', { phase: 'run', done, total }) },
        );
      } catch (err) {
        if (signal.aborted) return { cancelled: true, run: null, saveError: null };
        throw toUserError(err);
      }
      const { runNo: _assignedLater, ...unsaved } = result;
      const runs = await readRuns();
      const next = appendRun(runs, unsaved);
      const saved = next[next.length - 1];
      let saveError: string | null = null;
      try {
        await writeJson(runsFile(), next);
      } catch (err) {
        saveError = `未能保存這次核查（${err instanceof Error ? err.message : String(err)}），結果仍顯示於畫面，請及時匯出。`;
      }
      return { cancelled: false, run: saved, saveError };
    }));

  // AI 檢閱是否需要重新檢索：只看結果摘要；由研究者按下才呼叫 AI。服務錯誤直接告知；結果保存在該次核查上。
  ipcMain.handle('criteria:review', (_e, args: { runId: string; runNo: number; ai?: string }) =>
    withJob(args.runId, 'criteria', '納入排除核查：AI 檢閱', async (signal) => {
      const runs = await readRuns();
      const idx = runs.findIndex((r) => r.runNo === args.runNo);
      if (idx < 0) throw new Error('找不到這次核查的紀錄。');
      let review;
      try {
        const ai = await requireAi(normalizeAiMode(args.ai), signal);
        review = await reviewRerun(ai, runs[idx]);
      } catch (err) {
        throw toUserError(err);
      }
      runs[idx] = { ...runs[idx], review };
      await writeJson(runsFile(), runs);
      return { review, runNo: args.runNo };
    }));

  ipcMain.handle('criteria:runs', () => readRuns());

  ipcMain.handle('criteria:compare', async (_e, args: { aNo: number; bNo: number }) => {
    const runs = await readRuns();
    const a = runs.find((r) => r.runNo === args.aNo);
    const b = runs.find((r) => r.runNo === args.bNo);
    if (!a || !b) throw new Error('找不到要比較的核查紀錄。');
    return compareRuns(a, b);
  });

  ipcMain.handle('export:criteria', async (_e, args: { runNo: number }) => {
    const run = (await readRuns()).find((r) => r.runNo === args.runNo);
    if (!run) throw new Error('找不到這次核查的紀錄。');
    return autoSaveExport(`納入排除核查_第${run.runNo}次_${stamp()}.xlsx`, await buildCriteriaWorkbook(run));
  });
}
