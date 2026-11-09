// 個案研究筆記的雲端同步（選用）。
// 同步內容只含：標注、註解、判決的顯示快照（meta）、四色名稱、刪除墓碑。不含判決全文、AI 金鑰、檢索結果。
// 使用現有登入的存取權杖呼叫 judge-remote-mcp 的 /api/annotations（應用程式本身需登入後才能使用，同步沿用同一組權杖）。
// 權杖缺失或過期時拋出可理解的錯誤，且不改動本機資料。
// 衝突：伺服器版本較新（409）時，以 updatedAt（標注）與 exportedAt（名稱）較新者合併，再以伺服器版本號重送。
import type { Annotation } from '@judge/core';
import { resolveColorLabels, ANNOTATION_SCHEMA_VERSION, type AnnotationFile, type JudgmentAnnotations, type JudgmentNoteMeta } from './annotationService';

export const SYNC_SCHEMA_VERSION = 1;
/** 單次同步酬載上限（位元組）。 */
/** 與後端一致（Firestore 單一文件上限 1 MiB，保留餘量）。 */
export const SYNC_MAX_BYTES = 900 * 1024;
/** 衝突時最多重送次數。 */
export const SYNC_MAX_ATTEMPTS = 3;

export const MSG_NOT_SIGNED_IN = '尚未登入，無法同步。請先登入後再同步。';
export const MSG_EXPIRED = '登入已過期，請重新登入後再同步。';

export interface SyncTombstone {
  id: string;
  judgmentId: string;
  deletedAt: string;
}

export interface AnnotationSyncPayload {
  schemaVersion: number;
  exportedAt: string;
  judgments: { judgmentId: string; meta: JudgmentNoteMeta; annotations: Annotation[] }[];
  /** 四色名稱（完整四色；未自訂時省略）。 */
  colorLabels?: Record<string, string>;
  tombstones: SyncTombstone[];
}

export class SyncAuthError extends Error {
  readonly code = 'auth';
}

/** 由本機檔案組出同步酬載（純函式，不含判決全文）。 */
export function buildSyncPayload(file: AnnotationFile, now: Date = new Date()): AnnotationSyncPayload {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    judgments: Object.entries(file.judgments)
      .filter(([, e]) => e.annotations.length > 0)
      .map(([judgmentId, e]) => ({ judgmentId, meta: e.meta, annotations: e.annotations })),
    ...(file.colorLabels ? { colorLabels: resolveColorLabels(file.colorLabels) } : {}),
    tombstones: Object.entries(file.tombstones ?? {}).map(([id, t]) => ({ id, judgmentId: t.judgmentId, deletedAt: t.deletedAt })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 驗證伺服器回傳的酬載形狀（不信任伺服器內容的結構）。 */
export function isSyncPayload(v: unknown): v is AnnotationSyncPayload {
  if (!isObj(v)) return false;
  if (typeof v.schemaVersion !== 'number' || typeof v.exportedAt !== 'string') return false;
  if (!Array.isArray(v.judgments) || !Array.isArray(v.tombstones)) return false;
  const okJudgments = v.judgments.every((j) => isObj(j) && typeof j.judgmentId === 'string' && isObj(j.meta) && Array.isArray(j.annotations));
  const okTombs = v.tombstones.every((t) => isObj(t) && typeof t.id === 'string' && typeof t.judgmentId === 'string' && typeof t.deletedAt === 'string');
  const okLabels = v.colorLabels === undefined || isObj(v.colorLabels);
  return okJudgments && okTombs && okLabels;
}

/**
 * 合併兩份酬載（純函式）：
 * - 標注以 id 合併，updatedAt 較新者為準；刪除墓碑的 deletedAt 不早於標注的 updatedAt 時，該標注不保留。
 * - 判決顯示快照取 exportedAt 較新的酬載；沒有標注的判決不保留。
 * - 四色名稱取 exportedAt 較新且有自訂的酬載。
 */
export function mergePayloads(local: AnnotationSyncPayload, remote: AnnotationSyncPayload, now: Date = new Date()): AnnotationSyncPayload {
  const tomb = new Map<string, SyncTombstone>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    const cur = tomb.get(t.id);
    if (!cur || t.deletedAt > cur.deletedAt) tomb.set(t.id, t);
  }
  const judgments = new Map<string, { meta: JudgmentNoteMeta; metaAt: string; anns: Map<string, Annotation> }>();
  for (const p of [local, remote]) {
    for (const j of p.judgments) {
      let e = judgments.get(j.judgmentId);
      if (!e) {
        e = { meta: j.meta, metaAt: p.exportedAt, anns: new Map() };
        judgments.set(j.judgmentId, e);
      } else if (p.exportedAt >= e.metaAt) {
        e.meta = j.meta;
        e.metaAt = p.exportedAt;
      }
      for (const a of j.annotations) {
        const cur = e.anns.get(a.id);
        if (!cur || a.updatedAt > cur.updatedAt) e.anns.set(a.id, a);
      }
    }
  }
  const out: AnnotationSyncPayload['judgments'] = [];
  for (const [judgmentId, e] of [...judgments.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    const annotations = [...e.anns.values()].filter((a) => {
      const t = tomb.get(a.id);
      return !t || t.deletedAt < a.updatedAt;
    });
    if (annotations.length) out.push({ judgmentId, meta: e.meta, annotations });
  }
  const labelSources = [local, remote].filter((p) => p.colorLabels).sort((a, b) => (a.exportedAt < b.exportedAt ? -1 : 1));
  const colorLabels = labelSources.length ? labelSources[labelSources.length - 1].colorLabels : undefined;
  const exportedAt = [local.exportedAt, remote.exportedAt].sort().pop() as string;
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    exportedAt: now.toISOString() > exportedAt ? now.toISOString() : exportedAt,
    judgments: out,
    ...(colorLabels ? { colorLabels } : {}),
    tombstones: [...tomb.values()],
  };
}

/** 把合併後的酬載套回本機檔案（保留 schemaVersion 與版本號以外的欄位規則）。 */
export function fileFromPayload(file: AnnotationFile, payload: AnnotationSyncPayload, revision: number): AnnotationFile {
  const judgments: Record<string, JudgmentAnnotations> = {};
  for (const j of payload.judgments) judgments[j.judgmentId] = { meta: j.meta, annotations: j.annotations };
  const tombstones: NonNullable<AnnotationFile['tombstones']> = {};
  for (const t of payload.tombstones) tombstones[t.id] = { judgmentId: t.judgmentId, deletedAt: t.deletedAt };
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    judgments,
    colorLabels: payload.colorLabels ? resolveColorLabels(payload.colorLabels) : file.colorLabels,
    tombstones,
    syncRevision: revision,
  };
}

export function countAnnotations(p: AnnotationSyncPayload): number {
  return p.judgments.reduce((n, j) => n + j.annotations.length, 0);
}

export type SyncPutResult =
  | { status: 'ok'; revision: number }
  | { status: 'conflict'; revision: number; payload: AnnotationSyncPayload };

/** 同步傳輸介面（HTTP 實作見 HttpSyncTransport；測試可注入假實作）。 */
export interface SyncTransport {
  put(req: { baseRevision: number; payload: AnnotationSyncPayload }): Promise<SyncPutResult>;
}

export interface HttpSyncOptions {
  url: string;
  /** 取得可用的存取權杖；沒有登入時回傳 null。 */
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/** 以現有登入權杖呼叫後端：PUT { baseRevision, payload }；200 → ok，409 → 伺服器較新（附伺服器酬載）。 */
export class HttpSyncTransport implements SyncTransport {
  constructor(private readonly opts: HttpSyncOptions) {}

  async put(req: { baseRevision: number; payload: AnnotationSyncPayload }): Promise<SyncPutResult> {
    const token = await this.opts.getToken();
    if (!token) throw new SyncAuthError(MSG_NOT_SIGNED_IN);
    const body = JSON.stringify({ baseRevision: req.baseRevision, payload: req.payload });
    if (Buffer.byteLength(body, 'utf8') > SYNC_MAX_BYTES) throw new Error('標注資料超過單次同步上限（900 KB），請刪除不需要的筆記後再同步。');
    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(this.opts.url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body,
      });
    } catch {
      throw new Error('無法連線到同步伺服器，請檢查網路後重試。（本機資料不受影響）');
    }
    if (res.status === 401 || res.status === 403) throw new SyncAuthError(MSG_EXPIRED);
    const json: unknown = await res.json().catch(() => null);
    if (res.status === 409) {
      if (!isObj(json) || typeof json.revision !== 'number' || !isSyncPayload(json.payload)) throw new Error('同步伺服器回應格式不正確');
      return { status: 'conflict', revision: json.revision, payload: json.payload };
    }
    if (!res.ok) throw new Error(`同步失敗（伺服器回應 ${res.status}）`);
    if (!isObj(json) || typeof json.revision !== 'number') throw new Error('同步伺服器回應格式不正確');
    return { status: 'ok', revision: json.revision };
  }
}

export interface SyncStoreLike {
  read(): Promise<AnnotationFile>;
  replace(f: AnnotationFile): Promise<void>;
}

/**
 * 執行一次同步：送出本機酬載；衝突時與本機合併、套回本機，再以伺服器版本號重送（最多 SYNC_MAX_ATTEMPTS 次）。
 * 權杖缺失或過期時直接拋出 SyncAuthError，不改動本機資料。
 */
export async function runSync(
  store: SyncStoreLike,
  transport: SyncTransport,
  now: () => Date = () => new Date(),
): Promise<{ revision: number; merged: boolean; annotations: number }> {
  let baseRevision = (await store.read()).syncRevision ?? 0;
  let payload = buildSyncPayload(await store.read(), now());
  let merged = false;
  for (let attempt = 1; attempt <= SYNC_MAX_ATTEMPTS; attempt++) {
    const r = await transport.put({ baseRevision, payload });
    if (r.status === 'ok') {
      // 送出的內容即為伺服器版本；只更新版本號，不覆寫同步期間的本機編輯（它們會在下次同步送出）。
      await store.replace({ ...(await store.read()), syncRevision: r.revision });
      return { revision: r.revision, merged, annotations: countAnnotations(payload) };
    }
    merged = true;
    const current = await store.read();
    payload = mergePayloads(buildSyncPayload(current, now()), r.payload, now());
    await store.replace(fileFromPayload(current, payload, r.revision));
    baseRevision = r.revision;
  }
  throw new Error('同步衝突無法解決（多次嘗試後仍不一致），請稍後再試。');
}

/** 同步狀態（畫面用）：有存取權杖即可同步。 */
export function syncStatus(signedIn: boolean): { available: boolean; signedIn: boolean; reason: string } {
  return signedIn
    ? { available: true, signedIn: true, reason: '' }
    : { available: false, signedIn: false, reason: MSG_NOT_SIGNED_IN };
}
