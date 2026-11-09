// 個案研究筆記（issue #6）：文字區段標注的純函式。不做 I/O，可直接以 node 測試。
// 標注以「文字區段」儲存：起迄位置（以判決全文字元計）＋ 當時的全文雜湊 ＋ 引用文字。
// 全文版本變動時，雜湊不符即標示為「需重新對位」；只有引用文字在新全文中唯一出現時才會自動對位，否則不猜。
import { createHash } from 'node:crypto';

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'pink', 'blue'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** 預設四色的意義（使用者可在設定中改名；此處為預設值）。 */
export const DEFAULT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: '事實',
  green: '爭點',
  blue: '理由',
  pink: '主文',
};

export type AnnotationMode = 'highlight' | 'highlight_note';
export type AnnotationOrigin = 'manual' | 'ai';

export interface Annotation {
  id: string;
  judgmentId: string;
  start: number;
  end: number;
  quote: string;
  textHash: string;
  color: HighlightColor;
  mode: AnnotationMode;
  /** 單句註解（mode 為 highlight_note 時使用；highlight 模式可為空字串）。 */
  note: string;
  origin: AnnotationOrigin;
  createdAt: string;
  updatedAt: string;
}

export type AnchorStatus = 'ok' | 'needs_reanchor';

export function textHash(fullText: string): string {
  return createHash('sha256').update(fullText, 'utf8').digest('hex');
}

export interface NewAnnotationInput {
  judgmentId: string;
  start: number;
  end: number;
  color: HighlightColor;
  mode: AnnotationMode;
  note?: string;
  origin?: AnnotationOrigin;
  id?: string;
}

/** 建立標注。區段無效（超出全文、空白、或顏色不在四色內）時拋錯，不做靜默修正。 */
export function makeAnnotation(input: NewAnnotationInput, fullText: string, now: Date = new Date()): Annotation {
  if (!Number.isInteger(input.start) || !Number.isInteger(input.end)) throw new Error('標注區段必須是整數位置');
  if (input.start < 0 || input.end > fullText.length || input.start >= input.end) throw new Error('標注區段超出判決全文範圍');
  if (!(HIGHLIGHT_COLORS as readonly string[]).includes(input.color)) throw new Error('不支援的螢光顏色');
  const quote = fullText.slice(input.start, input.end);
  if (!quote.trim()) throw new Error('請選取有文字的範圍');
  const stamp = now.toISOString();
  return {
    id: input.id ?? `ann-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    judgmentId: input.judgmentId,
    start: input.start,
    end: input.end,
    quote,
    textHash: textHash(fullText),
    color: input.color,
    mode: input.mode,
    note: input.mode === 'highlight_note' ? (input.note ?? '').trim() : '',
    origin: input.origin ?? 'manual',
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** 標注是否仍對得上目前的全文：雜湊相同且該區段文字與引用文字一致。 */
export function anchorStatus(a: Annotation, fullText: string): AnchorStatus {
  if (a.textHash !== textHash(fullText)) return 'needs_reanchor';
  if (fullText.slice(a.start, a.end) !== a.quote) return 'needs_reanchor';
  return 'ok';
}

/**
 * 嘗試在新全文中重新對位：只有引用文字恰好出現一次時才更新位置；
 * 出現多次或完全找不到，回傳 null（呼叫端保留「需重新對位」狀態，由使用者決定）。
 */
export function reanchor(a: Annotation, fullText: string, now: Date = new Date()): Annotation | null {
  if (!a.quote) return null;
  const first = fullText.indexOf(a.quote);
  if (first < 0) return null;
  if (fullText.indexOf(a.quote, first + 1) >= 0) return null;
  return { ...a, start: first, end: first + a.quote.length, textHash: textHash(fullText), updatedAt: now.toISOString() };
}

/** 兩個區段是否重疊（半開區間 [start, end)）。 */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface RangeLike {
  start: number;
  end: number;
}

/** 合併重疊或相鄰的區間（回傳排序後不重疊的區間）。 */
export function mergeRanges<T extends RangeLike>(ranges: T[]): RangeLike[] {
  const sorted = [...ranges].sort((x, y) => x.start - y.start || x.end - y.end);
  const out: RangeLike[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

export interface TextSegment {
  start: number;
  end: number;
  text: string;
  /** 覆蓋此段的標注 id（由舊到新）。 */
  annotationIds: string[];
  /** 顯示顏色：取覆蓋此段中最新建立的標注顏色；沒有標注時為 null。 */
  color: HighlightColor | null;
}

/**
 * 把全文依所有標注的邊界切成段落，供畫面與 Word 匯出使用。
 * 只使用「狀態為 ok」的標注；需重新對位的標注不在此顯示（由呼叫端另列）。
 */
export function segmentText(fullText: string, annotations: Annotation[]): TextSegment[] {
  const active = annotations.filter((a) => a.start >= 0 && a.end <= fullText.length && a.start < a.end);
  const cuts = new Set<number>([0, fullText.length]);
  for (const a of active) {
    cuts.add(a.start);
    cuts.add(a.end);
  }
  const points = [...cuts].sort((x, y) => x - y);
  const segments: TextSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (start === end) continue;
    const covering = active
      .filter((a) => a.start <= start && a.end >= end)
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    const top = covering[covering.length - 1];
    segments.push({
      start,
      end,
      text: fullText.slice(start, end),
      annotationIds: covering.map((a) => a.id),
      color: top ? top.color : null,
    });
  }
  return segments;
}

/** 更新註解內容（顏色、模式、註解文字），不改變區段。 */
export function updateAnnotation(
  items: Annotation[],
  id: string,
  patch: { color?: HighlightColor; mode?: AnnotationMode; note?: string },
  now: Date = new Date(),
): Annotation[] {
  return items.map((a) => {
    if (a.id !== id) return a;
    const next: Annotation = { ...a, updatedAt: now.toISOString() };
    if (patch.color !== undefined) {
      if (!(HIGHLIGHT_COLORS as readonly string[]).includes(patch.color)) throw new Error('不支援的螢光顏色');
      next.color = patch.color;
    }
    if (patch.mode !== undefined) next.mode = patch.mode;
    if (patch.note !== undefined) next.note = patch.note.trim();
    if (next.mode === 'highlight') next.note = '';
    return next;
  });
}

export function removeAnnotation(items: Annotation[], id: string): Annotation[] {
  return items.filter((a) => a.id !== id);
}

/** 右欄註解列表：只列出有註解文字的標注，依位置排序，可點選跳回原文。 */
export function noteList(annotations: Annotation[]): Annotation[] {
  return annotations.filter((a) => a.mode === 'highlight_note' && a.note).sort((x, y) => x.start - y.start);
}
