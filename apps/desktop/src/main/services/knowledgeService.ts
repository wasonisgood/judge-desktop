// 爭點知識庫服務（issue #5）：從已安裝的知識庫模組讀入內容、以 Router 挑出相關爭點、組裝給 AI 的文字。
// 內容不包進安裝檔；由 Firebase 靜態儲存庫下載到使用者資料夾（見 installKnowledgeModule）。
// 任何一步失敗都只回傳空結果與說明，不中斷搜尋或判決流程。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildKnowledgeIndex, routeIssues, rerouteIssues, buildKnowledgeContext,
  type KnowledgeIndex, type KnowledgeContextOutput, type RerouteOutcome,
} from '@judge/core';
import { userData } from '../data/local/localPaths';

/** 內容發佈位置（與法規、模組相同的 Firebase 鏡像，見 knowledge/tools/publish-knowledge.mjs）。 */
export const KNOWLEDGE_MIRROR_BASE = 'https://firebasestorage.googleapis.com/v0/b/judge-remote-mcp-2026.firebasestorage.app/o/';
export const KNOWLEDGE_LATEST_OBJECT = 'judge-desktop/knowledge/latest.json';

export interface KnowledgeManifest {
  version: string;
  files: Array<{ name: string; sha256: string; size: number; object: string }>;
}

const knowledgeRoot = () => path.join(userData(), 'knowledge');
const currentDir = () => path.join(knowledgeRoot(), 'current');

let cached: { key: string; index: KnowledgeIndex } | null = null;

/** 讀入已安裝的知識庫；未安裝時回傳空索引。結果依目錄版本快取。 */
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

/** 依查詢挑出相關爭點並組裝成給 AI 的文字。 */
export function knowledgeContextFor(query: string, opts: { jurisdiction?: string; domain?: string } = {}): KnowledgeContextOutput {
  const { index, notes } = loadInstalledKnowledge();
  if (index.issues.length === 0) return { text: '', usedIds: [], notes: [notes[0] ?? '知識庫沒有內容'] };
  const routed = routeIssues(index, { query, jurisdiction: opts.jurisdiction, domain: opts.domain });
  const ctx = buildKnowledgeContext(routed.hits);
  return { ...ctx, notes: [...ctx.notes, ...notes.slice(0, 3)] };
}

/** AI 認為 Router 結果不準時，排除已給過的爭點重新檢索（上限見核心的 MAX_ROUTE_ATTEMPTS）。 */
export function rerouteKnowledge(query: string, previousIds: string[], previousAttempt: number): RerouteOutcome {
  const { index } = loadInstalledKnowledge();
  return rerouteIssues(index, { query, previousIds, previousAttempt });
}

/** 下載並安裝知識庫：逐檔比對 SHA-256，全部通過後才切換 current 指向新版本。失敗時保留舊版本。 */
export async function installKnowledgeModule(fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const latestRes = await fetchImpl(KNOWLEDGE_MIRROR_BASE + encodeURIComponent(KNOWLEDGE_LATEST_OBJECT) + '?alt=media');
    if (!latestRes.ok) return { ok: false, error: `取得知識庫清單失敗（HTTP ${latestRes.status}）` };
    const manifest = (await latestRes.json()) as KnowledgeManifest;
    if (!manifest.version || !Array.isArray(manifest.files)) return { ok: false, error: '知識庫清單格式不正確' };

    const target = path.join(knowledgeRoot(), `v${manifest.version}`);
    const dataDir = path.join(target, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    for (const f of manifest.files) {
      if (f.name.includes('..') || path.isAbsolute(f.name)) return { ok: false, error: `不安全的檔名：${f.name}` };
      const res = await fetchImpl(KNOWLEDGE_MIRROR_BASE + encodeURIComponent(f.object) + '?alt=media');
      if (!res.ok) return { ok: false, error: `下載 ${f.name} 失敗（HTTP ${res.status}）` };
      const buf = Buffer.from(await res.arrayBuffer());
      const sha = createHash('sha256').update(buf).digest('hex');
      if (sha !== f.sha256) return { ok: false, error: `${f.name} 的 SHA-256 不符，已拒絕安裝` };
      fs.writeFileSync(path.join(dataDir, f.name), buf);
    }
    // 全部通過後才切換 current（以目錄連結或複製實作；這裡用覆寫的 JSON 指標檔，避免 Windows 權限問題）。
    fs.mkdirSync(currentDir(), { recursive: true });
    const currentData = path.join(currentDir(), 'data');
    fs.rmSync(currentData, { recursive: true, force: true });
    fs.cpSync(dataDir, currentData, { recursive: true });
    fs.writeFileSync(path.join(currentDir(), 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    cached = null;
    return { ok: true, version: manifest.version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
