// IPC：事實見解檢索（issue #10）：段落重排、展開全文、結果內小助手。通道獨立於既有的 search:* 與 scope:*，不改動它們的行為。
import { ipcMain } from 'electron';
import { askScopedQuestion, type AiComplete, type ScopedCase, type PassageKind } from '@judge/core';
import { cachedSearch, cachedDetail } from '../data/cloud/courtRepo';
import { requireAi, normalizeAiMode } from '../data/cloud/aiRepo';
import { withJob } from '../services/jobRegistry';
import { safeSend } from '../services/safeSend';
import { toUserError } from '../services/userError';
import { runSemanticSearch, normalizeFilter, SEMANTIC_MAX_CANDIDATES, type SemanticFilter } from '../services/semanticService';

const MAX_CASES = SEMANTIC_MAX_CANDIDATES;
const MAX_QUESTION = 500;

export function registerSemanticIpc(): void {
  ipcMain.handle('semantic:run', (e, args: {
    runId: string; keyword: string; query: string; kind: PassageKind; filter?: Partial<SemanticFilter>; maxCandidates?: number; ai?: string;
  }) =>
    withJob(args.runId, 'search', `段落檢索：${args.keyword}`, async (signal) => {
      const keyword = String(args.keyword ?? '').trim();
      const query = String(args.query ?? '').trim();
      if (!keyword) throw new Error('請輸入搜尋關鍵字');
      if (!query) throw new Error('請輸入研究問題（用來排序段落）');
      const kind: PassageKind = args.kind === 'opinion' ? 'opinion' : 'fact';
      let ai: AiComplete | undefined;
      let aiError: string | undefined;
      try {
        ai = await requireAi(normalizeAiMode(args.ai), signal);
      } catch (err) {
        aiError = toUserError(err).message;
      }
      try {
        return await runSemanticSearch(
          { keyword, query, kind, filter: normalizeFilter(args.filter), maxCandidates: args.maxCandidates ?? SEMANTIC_MAX_CANDIDATES },
          {
            search: (kw, max) => cachedSearch(kw, max),
            detail: (id) => cachedDetail(id),
            ai,
            aiError,
            signal,
            onProgress: (p) => safeSend(e.sender, 'semantic:progress', p),
          },
        );
      } catch (err) {
        throw toUserError(err);
      }
    }));

  // 展開全文：取自判決內文快取（已讀取過的判決不會再請求司法院）。
  ipcMain.handle('semantic:fullText', async (_e, args: { id: string }) => {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少判決編號');
    try {
      const d = await cachedDetail(id);
      return { title: d.meta.title, sourceUrl: d.meta.sourceUrl, fullText: d.fullText };
    } catch (err) {
      throw toUserError(err);
    }
  });

  // 結果內小助手：只把目前結果集的段落交給 AI；回答的案號若不在結果集內，由 checkScopedAnswer 標示為不可採信。
  ipcMain.handle('semantic:ask', (_e, args: { runId: string; question: string; cases: ScopedCase[]; ai?: string }) =>
    withJob(args.runId, 'assistant', '結果內小助手', async (signal) => {
      const question = String(args.question ?? '').trim().slice(0, MAX_QUESTION);
      if (!question) throw new Error('請輸入問題');
      const cases = (Array.isArray(args.cases) ? args.cases : [])
        .filter((c) => c && typeof c.caseNo === 'string' && c.caseNo && Array.isArray(c.passages))
        .slice(0, MAX_CASES)
        .map((c) => ({ caseNo: c.caseNo, passages: c.passages.filter((p) => typeof p === 'string') }));
      if (!cases.length) throw new Error('結果集是空的，無法回答');
      try {
        const ai = await requireAi(normalizeAiMode(args.ai), signal);
        return await askScopedQuestion(ai, question, cases);
      } catch (err) {
        throw toUserError(err);
      }
    }));
}
