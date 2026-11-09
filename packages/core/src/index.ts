export * from './court/client';
export * from './court/parse';
export * from './court/search';
export * from './text/normalize';
export * from './text/snippets';
export * from './court/scope';
export * from './court/caseType';
export * from './ai/analysis';
export * from './law/citation';
export * from './law/structure';
export * from './law/articles';
export * from './law/history';
export * from './law/period';
export * from './law/client';
export * from './law/curlFetch';
export * from './law/citationNotes';
export * from './court/aliases';
export * from './ai/federation';
export * from './court/history';
export * from './law/resolveName';
export * from './ai/evidence';
export * from './pdf/judgmentPdf';
export * from './local/hardware';
export * from './local/probe';
export * from './local/router';
export * from './local/parseHardware';
export * from './local/ollama';
export * from './local/installFlow';
export * from './local/updateDiff';
export * from './local/telemetry';
export * from './modules/registry';
export * from './modules/crawlerModule';
export * from './modules/chartModule';
export * from './engine/stream';
export * from './engine/errors';
export * from './engine/retry';
export * from './engine/download';
export * from './engine/health';
export * from './engine/repair';
export * from './engine/signature';
export * from './engine/arch';
export * from './engine/release';
export * from './engine/diagnostics';
export * from './engine/version';
export * from './modules/catalog';
export * from './modules/apply';
export * from './engine/mirror';
export * from './modules/mirrorUrls';
export * from './jurisdiction/registry';
export * from './auth/pkce';
export * from './local/gpuProbe';
export * from './local/prerequisites';
export * from './modules/bundleSync';
export * from './court/manualIds';
export * from './pipeline/trace';
export * from './pipeline/queryRounds';
export * from './pipeline/settle';
export * from './pipeline/proposeQueries';
export * from './pipeline/searchBudget';
export * from './pipeline/lawContext';
export * from './pipeline/cancel';
export * from './pipeline/errorMessage';
export * from './ai/federationSetup';

// 爭點知識庫（issue #5）：型別、驗證、Router 與上下文組裝（純函式，不做檔案 I/O）。
export {
  KNOWLEDGE_SCHEMA_VERSION, type Doctrine, type PracticeView, type Issue, type KnowledgeFile,
  type IndexedIssue, type KnowledgeIndex,
} from './knowledge/types';
export {
  validateIssue, validateKnowledgeFile, type ValidationProblem, type ValidatedFile,
} from './knowledge/validate';
export {
  routeIssues, rerouteIssues, scoreIssue, diceSimilarity, normalizeText, MAX_ROUTE_ATTEMPTS,
  type RouteOptions as KnowledgeRouteOptions, type RouteHit as KnowledgeRouteHit,
  type RouteResult as KnowledgeRouteResult, type RerouteRequest, type RerouteOutcome,
} from './knowledge/router';
export {
  buildKnowledgeContext, buildKnowledgeIndex, KNOWLEDGE_CONTEXT_MAX_CHARS,
  type KnowledgeContextOutput, type KnowledgeBuildResult,
} from './knowledge/context';
export {
  buildReviewPrompt, parseReviewReply, type ReviewPrompt, type ReviewReply,
} from './knowledge/review';
export * from './annotation/anchor';
export * from './chart/stats';
export * from './chart/data';
export * from './chart/svg';
export * from './chart/tiles';
export * from './chart/courtMap';
export * from './chart/map';
export * from './pipeline/criteria';
export * from './court/passages';
export * from './ai/semanticRank';
export * from './ai/scopedQa';
export * from './pipeline/designGuide';
