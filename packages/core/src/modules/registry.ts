// 模組登錄：每個可獨立更新的模組（本地 AI 引擎、爬取模組）各自保存版本與狀態。
// 關鍵規則：更新或失敗某一個模組時，不會改動另一個模組的狀態。
import { planUpdate, type FileManifest, type UpdatePlan } from '../local/updateDiff';

export type ModuleId = 'ai-engine' | 'crawler';

export const MODULE_IDS: ModuleId[] = ['ai-engine', 'crawler'];

export type ModuleStatus = 'not-installed' | 'installing' | 'ready' | 'failed' | 'disabled';

export interface ModuleState {
  id: ModuleId;
  /** 目前安裝的模組版本（與應用程式版本分開）；未安裝為 null。 */
  installedVersion: string | null;
  status: ModuleStatus;
  /** 最近一次失敗的摘要（已去敏）。 */
  lastError: string | null;
  /** 失敗時所在的安裝階段。 */
  failedStage: string | null;
  updatedAt: string | null;
}

export interface ModuleManifest {
  id: ModuleId;
  version: string;
  /** 相對路徑 → SHA-256。 */
  files: FileManifest;
}

export function emptyModuleState(id: ModuleId): ModuleState {
  return { id, installedVersion: null, status: 'not-installed', lastError: null, failedStage: null, updatedAt: null };
}

export class ModuleRegistry {
  private states: Record<ModuleId, ModuleState>;

  constructor(initial?: Partial<Record<ModuleId, ModuleState>>) {
    this.states = {
      'ai-engine': { ...emptyModuleState('ai-engine'), ...(initial?.['ai-engine'] ?? {}) },
      crawler: { ...emptyModuleState('crawler'), ...(initial?.crawler ?? {}) },
    };
  }

  get(id: ModuleId): ModuleState {
    return { ...this.states[id] };
  }

  /** 更新單一模組的狀態；其他模組不受影響（回傳新的登錄快照以便檢查）。 */
  set(id: ModuleId, patch: Partial<ModuleState>, now: () => string = () => new Date().toISOString()): ModuleState {
    this.states[id] = { ...this.states[id], ...patch, id, updatedAt: now() };
    return { ...this.states[id] };
  }

  toJSON(): Record<ModuleId, ModuleState> {
    return { 'ai-engine': { ...this.states['ai-engine'] }, crawler: { ...this.states.crawler } };
  }
}

/** 計算單一模組的更新計畫。核心檔案變動（fullRequired）時由呼叫端整包下載該模組。 */
export function planModuleUpdate(id: ModuleId, oldManifest: ModuleManifest | null, newManifest: ModuleManifest): UpdatePlan & { moduleId: ModuleId; fromVersion: string | null; toVersion: string } {
  if (newManifest.id !== id) throw new Error(`清單模組不符：預期 ${id}，實際 ${newManifest.id}`);
  const plan = planUpdate(oldManifest?.files ?? {}, newManifest.files, { corePrefixes: [`modules/${id}/core/`] });
  return { ...plan, moduleId: id, fromVersion: oldManifest?.version ?? null, toVersion: newManifest.version };
}
