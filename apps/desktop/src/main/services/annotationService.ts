// 個案研究筆記（issue #6）：文字區段標注的檔案式儲存（userData/annotations.json，與 library.json 分開）。
// 格式：{ schemaVersion, judgments: { [judgmentId]: { meta, annotations[] } } }。
// 讀取時對每筆標注跑 anchorStatus；需重新對位者標示為 needs_reanchor，由使用者決定是否嘗試 reanchor。
// 本檔不匯入 electron，可直接以 node 測試。
import * as fs from 'node:fs/promises';
import {
  makeAnnotation, anchorStatus, reanchor, updateAnnotation, removeAnnotation, HIGHLIGHT_COLORS, DEFAULT_COLOR_LABELS,
  type Annotation, type AnchorStatus, type NewAnnotationInput, type AnnotationMode, type HighlightColor,
} from '@judge/core';

export const ANNOTATION_SCHEMA_VERSION = 1;

/** 顏色名稱（四色）。預設為事實、爭點、主文、理由；使用者可改名，存於檔案頂層的 colorLabels。 */
export type ColorLabels = Record<HighlightColor, string>;
export const COLOR_LABEL_MAX = 12;

/** 合併使用者設定與預設值（缺項或空白時用預設）。 */
export function resolveColorLabels(custom?: Partial<Record<HighlightColor, string>>): ColorLabels {
  const out = { ...DEFAULT_COLOR_LABELS } as ColorLabels;
  for (const c of HIGHLIGHT_COLORS) {
    const v = custom?.[c];
    if (typeof v === 'string' && v.trim()) out[c] = v.trim();
  }
  return out;
}

/** 驗證使用者輸入的顏色名稱：缺項沿用 base（目前保存的名稱）；有值者必須非空、不超過上限、不含換行。 */
export function validateColorLabels(input: unknown, base: ColorLabels = { ...DEFAULT_COLOR_LABELS } as ColorLabels): ColorLabels {
  if (!input || typeof input !== 'object') throw new Error('顏色名稱格式不正確');
  const src = input as Record<string, unknown>;
  const out = { ...base } as ColorLabels;
  for (const c of HIGHLIGHT_COLORS) {
    const v = src[c];
    if (v === undefined) continue;
    if (typeof v !== 'string') throw new Error('顏色名稱必須是文字');
    const t = v.trim();
    if (!t) throw new Error('顏色名稱不可空白');
    if (t.length > COLOR_LABEL_MAX || /[\r\n]/.test(t)) throw new Error(`顏色名稱最多 ${COLOR_LABEL_MAX} 字，且不可換行`);
    out[c] = t;
  }
  return out;
}

/** 判決的顯示資訊快照（不含全文），讓「過去筆記」列表不必重新抓取判決。 */
export interface JudgmentNoteMeta {
  title: string;
  caseNo: string;
  court: string;
  dateIso: string;
  cause: string;
  sourceUrl: string;
  jurisdiction: string;
}

export interface JudgmentAnnotations {
  meta: JudgmentNoteMeta;
  annotations: Annotation[];
}

export interface AnnotationFile {
  schemaVersion: number;
  judgments: Record<string, JudgmentAnnotations>;
  /** 使用者自訂的顏色名稱（可省略；省略時用預設）。 */
  colorLabels?: Partial<ColorLabels>;
  /** 同步用：本機刪除過的標注（id → 所屬判決與刪除時間），避免同步時被舊版本帶回。 */
  tombstones?: Record<string, { judgmentId: string; deletedAt: string }>;
  /** 最近一次同步成功時伺服器的版本號（尚未同步過時省略）。 */
  syncRevision?: number;
}

export type AnnotationView = Annotation & { status: AnchorStatus };

export function emptyAnnotationFile(): AnnotationFile {
  return { schemaVersion: ANNOTATION_SCHEMA_VERSION, judgments: {} };
}

/** 解析檔案內容。格式損毀或版本較新時拋錯，避免覆寫使用者的標注。 */
export function parseAnnotationFile(text: string): AnnotationFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('標注檔案無法讀取（格式損毀）。為避免覆寫，已停止存取；請保留該檔案並回報問題。');
  }
  const f = parsed as Partial<AnnotationFile>;
  if (!f || typeof f !== 'object' || typeof f.schemaVersion !== 'number' || typeof f.judgments !== 'object' || f.judgments === null) {
    throw new Error('標注檔案格式不正確。為避免覆寫，已停止存取。');
  }
  if (f.schemaVersion > ANNOTATION_SCHEMA_VERSION) {
    throw new Error('標注檔案來自較新的版本，請更新應用程式後再開啟。');
  }
  const colorLabels = f.colorLabels && typeof f.colorLabels === 'object' ? f.colorLabels : undefined;
  const tombstones = f.tombstones && typeof f.tombstones === 'object' ? f.tombstones : undefined;
  const syncRevision = typeof f.syncRevision === 'number' && f.syncRevision >= 0 ? f.syncRevision : undefined;
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    judgments: f.judgments as Record<string, JudgmentAnnotations>,
    ...(colorLabels ? { colorLabels } : {}),
    ...(tombstones ? { tombstones } : {}),
    ...(syncRevision !== undefined ? { syncRevision } : {}),
  };
}

/** 為每筆標注加上對位狀態（不改變資料本身）。 */
export function withStatus(annotations: Annotation[], fullText: string): AnnotationView[] {
  return annotations.map((a) => ({ ...a, status: anchorStatus(a, fullText) }));
}

/** 純函式：新增一筆（回傳新檔案內容，不做 I/O）。 */
export function addToFile(
  file: AnnotationFile, judgmentId: string, meta: JudgmentNoteMeta, input: NewAnnotationInput, fullText: string, now: Date = new Date(),
): { file: AnnotationFile; annotation: Annotation } {
  const annotation = makeAnnotation({ ...input, judgmentId }, fullText, now);
  const prev = file.judgments[judgmentId];
  const next: AnnotationFile = {
    ...file,
    judgments: { ...file.judgments, [judgmentId]: { meta, annotations: [...(prev?.annotations ?? []), annotation] } },
  };
  return { file: next, annotation };
}

/** 純函式：更新一筆標注。找不到時拋錯。 */
export function patchInFile(
  file: AnnotationFile, judgmentId: string, id: string, patch: { color?: HighlightColor; mode?: AnnotationMode; note?: string }, now: Date = new Date(),
): AnnotationFile {
  const entry = file.judgments[judgmentId];
  if (!entry || !entry.annotations.some((a) => a.id === id)) throw new Error('找不到這筆標注');
  return {
    ...file,
    judgments: { ...file.judgments, [judgmentId]: { ...entry, annotations: updateAnnotation(entry.annotations, id, patch, now) } },
  };
}

/** 純函式：刪除一筆標注，並留下墓碑（同步時避免被其他裝置的舊版本帶回）。 */
export function removeFromFile(file: AnnotationFile, judgmentId: string, id: string, now: Date = new Date()): { file: AnnotationFile; removed: boolean } {
  const entry = file.judgments[judgmentId];
  if (!entry || !entry.annotations.some((a) => a.id === id)) return { file, removed: false };
  const annotations = removeAnnotation(entry.annotations, id);
  const tombstones = { ...(file.tombstones ?? {}), [id]: { judgmentId, deletedAt: now.toISOString() } };
  return { file: { ...file, judgments: { ...file.judgments, [judgmentId]: { ...entry, annotations } }, tombstones }, removed: true };
}

/** 檔案式儲存（讀寫 JSON；寫入採「先寫暫存檔再改名」，避免寫到一半毀損）。 */
export class AnnotationStore {
  constructor(private readonly file: string) {}

  async read(): Promise<AnnotationFile> {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyAnnotationFile();
      throw err;
    }
    return parseAnnotationFile(text);
  }

  private async write(f: AnnotationFile): Promise<void> {
    await fs.mkdir(this.file.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(f, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  async listJudgments(): Promise<{ judgmentId: string; meta: JudgmentNoteMeta; count: number }[]> {
    const f = await this.read();
    return Object.entries(f.judgments)
      .map(([judgmentId, e]) => ({ judgmentId, meta: e.meta, count: e.annotations.length }))
      .sort((a, b) => a.meta.title.localeCompare(b.meta.title));
  }

  /** 讀取某判決的標注（含對位狀態）。順便更新顯示用的 meta 快照（僅在有變動時寫入）。 */
  async list(judgmentId: string, fullText: string, meta?: JudgmentNoteMeta): Promise<AnnotationView[]> {
    const f = await this.read();
    const entry = f.judgments[judgmentId];
    if (meta && entry && JSON.stringify(entry.meta) !== JSON.stringify(meta)) {
      f.judgments[judgmentId] = { ...entry, meta };
      await this.write(f);
    }
    return withStatus(entry?.annotations ?? [], fullText);
  }

  async getColorLabels(): Promise<ColorLabels> {
    return resolveColorLabels((await this.read()).colorLabels);
  }

  /** 儲存顏色名稱（驗證後寫入）；回傳實際保存的完整四色名稱。 */
  async setColorLabels(input: unknown): Promise<ColorLabels> {
    const f = await this.read();
    const labels = validateColorLabels(input, resolveColorLabels(f.colorLabels));
    f.colorLabels = labels;
    await this.write(f);
    return labels;
  }

  /** 原始資料（不含對位狀態），供匯出與同步使用。 */
  async raw(judgmentId: string): Promise<JudgmentAnnotations | null> {
    const f = await this.read();
    return f.judgments[judgmentId] ?? null;
  }

  async add(judgmentId: string, meta: JudgmentNoteMeta, input: NewAnnotationInput, fullText: string): Promise<AnnotationView> {
    const f = await this.read();
    const r = addToFile(f, judgmentId, meta, input, fullText);
    await this.write(r.file);
    return { ...r.annotation, status: 'ok' };
  }

  async update(judgmentId: string, id: string, patch: { color?: HighlightColor; mode?: AnnotationMode; note?: string }): Promise<void> {
    await this.write(patchInFile(await this.read(), judgmentId, id, patch));
  }

  async remove(judgmentId: string, id: string): Promise<boolean> {
    const r = removeFromFile(await this.read(), judgmentId, id);
    if (r.removed) await this.write(r.file);
    return r.removed;
  }

  /** 以整個檔案內容取代（僅供同步套用合併結果）。 */
  async replace(f: AnnotationFile): Promise<void> {
    await this.write({ ...f, schemaVersion: ANNOTATION_SCHEMA_VERSION });
  }

  /** 嘗試重新對位；只有引用文字在新全文中恰好出現一次才會成功。 */
  async reanchor(judgmentId: string, id: string, fullText: string): Promise<AnnotationView | null> {
    const f = await this.read();
    const entry = f.judgments[judgmentId];
    const target = entry?.annotations.find((a) => a.id === id);
    if (!entry || !target) throw new Error('找不到這筆標注');
    const moved = reanchor(target, fullText);
    if (!moved) return null;
    f.judgments[judgmentId] = { ...entry, annotations: entry.annotations.map((a) => (a.id === id ? moved : a)) };
    await this.write(f);
    return { ...moved, status: 'ok' };
  }
}
