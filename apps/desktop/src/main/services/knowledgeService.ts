// 爭點知識庫服務（issue #5）：從已安裝的知識庫模組讀入內容、以 Router 挑出相關爭點、
// 由 AI 檢閱結果並在不相關時要求重新檢索，最後組裝成給 AI 的文字。
// 內容不包進安裝檔；由 Firebase 靜態儲存庫下載到使用者資料夾（見 installKnowledgeModule）。
// 任何一步失敗都只回傳空結果與說明，不中斷搜尋或判決流程。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildKnowledgeIndex, routeIssues, rerouteIssues, buildKnowledgeContext,
  buildReviewPrompt, parseReviewReply,
  type KnowledgeIndex, type KnowledgeContextOutput, type RerouteOutcome, type KnowledgeRouteResult,
  type AiComplete,
} from '@judge/core';
import { userData } from '../data/local/localPaths';

/** 內容發佈位置（與法規、模組相同的 Firebase 鏡像，見 knowledge/tools/publish-knowledge.mjs）。 */
export const KNOWLEDGE_MIRROR_BASE = 'https://firebasestorage.googleapis.com/v0/b/judge-remote-mcp-2026.firebasestorage.app/o/';
export const KNOWLEDGE_LATEST_OBJECT = 'judge-desktop/knowledge/latest.json';

export interface KnowledgeManifest {
  version: string;
  issueCount?: number;
  files: Array<{ name: string; sha256: string; size: number; object: string }>;
}

const knowledgeRoot = () => path.join(userData(), 'knowledge');
const currentDir = () => path.join(knowledgeRoot(), 'current');

let cached: { key: string; index: KnowledgeIndex } | null = null;
let lastInstallError: string | null = null;
let installing: Promise<InstallResult> | null = null;

/** 讀入已安裝的知識庫；未安裝時回傳空索引。結果依檔案時間快取。 */
export function loadInstalledKnowledge(): { index: KnowledgeIndex; notes: string[] } {
  const dir = path.join(currentDir(), 'data');
  if (!fs.existsSync(dir)) return { index: { issues: [] }, notes: ['知識庫尚未安裝'] };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const key = files.map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`).join('|');
  if (cached && cached.key === key) return { index: cached.index, notes: [] };
  const sources = files.map((f) => ({ source: f, raw: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as unknown }));
  const built = buildKnowledgeIndex(sources);
  cached = { key, index: built.index };
  const notes = built.problems.map((p) => `知識庫 ${p.source}${p.issueId ? `（${p.issueId}）` : ''}：${p.message}`);
  return { index: built.index, notes };
}

/** 依查詢挑出相關爭點並組裝成給 AI 的文字（不經 AI 檢閱）。 */
export function knowledgeContextFor(query: string, opts: { jurisdiction?: string; domain?: string } = {}): KnowledgeContextOutput {
  const { index, notes } = loadInstalledKnowledge();
  if (index.issues.length === 0) return { text: '', usedIds: [], notes: [notes[0] ?? '知識庫沒有內容'] };
  const routed = routeIssues(index, { query, jurisdiction: opts.jurisdiction, domain: opts.domain });
  const ctx = buildKnowledgeContext(routed.hits);
  return { ...ctx, notes: [...ctx.notes, ...notes.slice(0, 3)] };
}

export interface ReviewedKnowledge extends KnowledgeContextOutput {
  /** 檢索次數（含第一次）。 */
  attempts: number;
  /** 實際查過的查詢詞（第一次為原查詢）。 */
  queries: string[];
  /** AI 是否判定結果相關（未經 AI 檢閱時為 null）。 */
  judgedRelevant: boolean | null;
}

/**
 * 含 AI 檢閱的知識庫檢索：
 * 1. Router 依查詢挑出爭點；2. AI 判斷是否相關；3. 不相關且 AI 提出更精準的查詢詞時，排除已給過的爭點重新檢索（上限見核心 MAX_ROUTE_ATTEMPTS）。
 * AI 最終仍判定不相關時，不餵入知識庫內容，避免干擾判讀。
 */
export async function knowledgeContextWithReview(
  ai: AiComplete | null,
  query: string,
  opts: { jurisdiction?: string; domain?: string } = {},
): Promise<ReviewedKnowledge> {
  const { index, notes } = loadInstalledKnowledge();
  if (index.issues.length === 0) {
    return { text: '', usedIds: [], notes: [notes[0] ?? '知識庫沒有內容'], attempts: 0, queries: [], judgedRelevant: null };
  }
  const queries = [query];
  let current: KnowledgeRouteResult = routeIssues(index, { query, jurisdiction: opts.jurisdiction, domain: opts.domain }, 1);
  let judgedRelevant: boolean | null = null;

  if (ai) {
    for (;;) {
      const prompt = buildReviewPrompt(queries[queries.length - 1], current.hits);
      let reply: ReturnType<typeof parseReviewReply> = null;
      try {
        reply = parseReviewReply(await ai(prompt.system, prompt.user, 200));
      } catch {
        reply = null;
      }
      if (!reply) break; // AI 無法判讀：維持目前結果，不再重試
      if (reply.ok) { judgedRelevant = true; break; }
      judgedRelevant = false;
      if (!reply.query) break;
      const outcome: RerouteOutcome = rerouteIssues(index, {
        query: reply.query,
        previousIds: current.hits.map((h) => h.issue.id),
        previousAttempt: current.attempt,
        jurisdiction: opts.jurisdiction,
        domain: opts.domain,
      });
      if (!outcome.ok) break;
      current = outcome.result;
      queries.push(reply.query);
    }
  }

  if (judgedRelevant === false) {
    return {
      text: '', usedIds: [], attempts: current.attempt, queries, judgedRelevant,
      notes: [...notes.slice(0, 3), 'AI 判定知識庫檢索結果與查詢不相關，未餵入爭點內容。'],
    };
  }
  const ctx = buildKnowledgeContext(current.hits);
  return { ...ctx, notes: [...ctx.notes, ...notes.slice(0, 3)], attempts: current.attempt, queries, judgedRelevant };
}

export interface KnowledgeStatus {
  installed: boolean;
  version: string | null;
  issueCount: number;
  lastError: string | null;
  installing: boolean;
}

/** 目前安裝狀態（給設定頁顯示）。 */
export function knowledgeStatus(): KnowledgeStatus {
  const manifestPath = path.join(currentDir(), 'manifest.json');
  let version: string | null = null;
  if (fs.existsSync(manifestPath)) {
    try { version = (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as KnowledgeManifest).version ?? null; } catch { version = null; }
  }
  return {
    installed: version !== null,
    version,
    issueCount: loadInstalledKnowledge().index.issues.length,
    lastError: lastInstallError,
    installing: installing !== null,
  };
}

export interface InstallResult { ok: boolean; version?: string; upToDate?: boolean; error?: string }

/** 下載並安裝知識庫。同時只會有一個安裝在進行；版本相同則略過。 */
export function installKnowledgeModule(fetchImpl: typeof fetch = fetch): Promise<InstallResult> {
  if (installing) return installing;
  installing = doInstall(fetchImpl).then((r) => {
    lastInstallError = r.ok ? null : (r.error ?? '未知錯誤');
    return r;
  }).finally(() => { installing = null; });
  return installing;
}

async function doInstall(fetchImpl: typeof fetch): Promise<InstallResult> {
  try {
    const latestRes = await fetchImpl(KNOWLEDGE_MIRROR_BASE + encodeURIComponent(KNOWLEDGE_LATEST_OBJECT) + '?alt=media');
    if (!latestRes.ok) return { ok: false, error: `取得知識庫清單失敗（HTTP ${latestRes.status}）` };
    const manifest = (await latestRes.json()) as KnowledgeManifest;
    if (!manifest.version || !Array.isArray(manifest.files)) return { ok: false, error: '知識庫清單格式不正確' };

    if (knowledgeStatus().version === manifest.version) {
      return { ok: true, version: manifest.version, upToDate: true };
    }

    const target = path.join(knowledgeRoot(), `v${manifest.version}`);
    const dataDir = path.join(target, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    for (const f of manifest.files) {
      if (f.name.includes('..') || path.isAbsolute(f.name) || /[\\/]/.test(f.name)) return { ok: false, error: `不安全的檔名：${f.name}` };
      const res = await fetchImpl(KNOWLEDGE_MIRROR_BASE + encodeURIComponent(f.object) + '?alt=media');
      if (!res.ok) return { ok: false, error: `下載 ${f.name} 失敗（HTTP ${res.status}）` };
      const buf = Buffer.from(await res.arrayBuffer());
      const sha = createHash('sha256').update(buf).digest('hex');
      if (sha !== f.sha256) return { ok: false, error: `${f.name} 的 SHA-256 不符，已拒絕安裝` };
      fs.writeFileSync(path.join(dataDir, f.name), buf);
    }
    // 全部通過後才切換 current；失敗時保留舊版本。
    fs.mkdirSync(currentDir(), { recursive: true });
    const currentData = path.join(currentDir(), 'data');
    fs.rmSync(currentData, { recursive: true, force: true });
    fs.cpSync(dataDir, currentData, { recursive: true });
    fs.writeFileSync(path.join(currentDir(), 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    cached = null;
    return { ok: true, version: manifest.version, upToDate: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
