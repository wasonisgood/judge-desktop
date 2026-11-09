// 個案研究筆記的雲端同步：只定義資料格式與介面（未完成，待使用者決定後端：Firebase 或既有登入）。
// 同步內容只含標注、註解與判決的顯示快照（meta）；不含判決全文、AI 金鑰、檢索結果。
// 未登入或未設定後端時，所有本機功能照常運作；同步一律是選用。
import type { JudgmentAnnotations } from './annotationService';

export const SYNC_SCHEMA_VERSION = 1;

export interface AnnotationSyncPayload {
  schemaVersion: number;
  exportedAt: string;
  judgments: { judgmentId: string; meta: JudgmentAnnotations['meta']; annotations: JudgmentAnnotations['annotations'] }[];
  /** 使用者自訂的四色名稱（省略時為預設）。 */
  colorLabels?: Record<string, string>;
}

/** 同步後端介面。實作者需處理衝突（以 updatedAt 較新者為準，刪除需保留墓碑）。 */
export interface AnnotationSyncBackend {
  readonly name: string;
  push(payload: AnnotationSyncPayload): Promise<void>;
  pull(): Promise<AnnotationSyncPayload | null>;
}

export interface AnnotationSyncStatus {
  available: boolean;
  reason: string;
}

/** 尚未選定後端時的預設實作：狀態回報為不可用，寫入與讀取都明確拋錯（不假裝同步成功）。 */
export const notConfiguredBackend: AnnotationSyncBackend = {
  name: 'none',
  async push() {
    throw new Error('雲端同步尚未設定（後端待決定）。標注目前只保存在本機。');
  },
  async pull() {
    throw new Error('雲端同步尚未設定（後端待決定）。');
  },
};

export function syncStatus(backend: AnnotationSyncBackend = notConfiguredBackend): AnnotationSyncStatus {
  if (backend.name === 'none') return { available: false, reason: '雲端同步尚未設定，標注只保存在本機。' };
  return { available: true, reason: '' };
}

/** 由檔案內容組出同步酬載（純函式）。 */
export function buildSyncPayload(
  judgments: Record<string, JudgmentAnnotations>,
  now: Date = new Date(),
  colorLabels?: Record<string, string>,
): AnnotationSyncPayload {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    judgments: Object.entries(judgments).map(([judgmentId, e]) => ({ judgmentId, meta: e.meta, annotations: e.annotations })),
    ...(colorLabels ? { colorLabels } : {}),
  };
}
