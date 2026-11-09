// 個案研究筆記（issue #6）：文字區段標注的檔案式儲存（userData/annotations.json，與 library.json 分開）。
// 格式：{ schemaVersion, judgments: { [judgmentId]: { meta, annotations[] } } }。
// 讀取時對每筆標注跑 anchorStatus；需重新對位者標示為 needs_reanchor，由使用者決定是否嘗試 reanchor。
// 本檔不匯入 electron，可直接以 node 測試。
import * as fs from 'node:fs/promises';
import {
  makeAnnotation, anchorStatus, reanchor, updateAnnotation, removeAnnotation,
  type Annotation, type AnchorStatus, type NewAnnotationInput, type AnnotationMode, type HighlightColor,
} from '@judge/core';

export const ANNOTATION_SCHEMA_VERSION = 1;

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
  return { schemaVersion: ANNOTATION_SCHEMA_VERSION, judgments: f.judgments as Record<string, JudgmentAnnotations> };
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

/** 純函式：刪除一筆標注。 */
export function removeFromFile(file: AnnotationFile, judgmentId: string, id: string): { file: AnnotationFile; removed: boolean } {
  const entry = file.judgments[judgmentId];
  if (!entry || !entry.annotations.some((a) => a.id === id)) return { file, removed: false };
  const annotations = removeAnnotation(entry.annotations, id);
  return { file: { ...file, judgments: { ...file.judgments, [judgmentId]: { ...entry, annotations } } }, removed: true };
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
