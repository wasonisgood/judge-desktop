// 本地／雲端適配器（Router）：依任務類型選擇後端，本地連續失敗時自動切回雲端，並有冷卻時間。
// 純邏輯；實際後端以 callback 注入，方便測試。

export type TaskKind = 'judgment' | 'chat' | 'crawl';
export type BackendKind = 'local' | 'cloud';

export interface RouterBackend {
  kind: BackendKind;
  /** 執行任務；失敗時拋出錯誤。 */
  run<T>(task: TaskKind, payload: unknown): Promise<T>;
}

export interface RouterOptions {
  /** 連續失敗幾次後暫停使用本地後端。預設 3。 */
  failureThreshold?: number;
  /** 暫停時間（毫秒）。預設 5 分鐘。 */
  cooldownMs?: number;
  now?: () => number;
}

interface Health {
  consecutiveFailures: number;
  /** 暫停到此時間為止（毫秒時間戳）；0 表示未暫停。 */
  pausedUntil: number;
  successes: number;
  failures: number;
}

export interface RouteResult<T> {
  value: T;
  backend: BackendKind;
  /** 本地失敗後是否改由雲端處理。 */
  fellBack: boolean;
}

export class LocalCloudRouter {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly health: Record<BackendKind, Health> = {
    local: { consecutiveFailures: 0, pausedUntil: 0, successes: 0, failures: 0 },
    cloud: { consecutiveFailures: 0, pausedUntil: 0, successes: 0, failures: 0 },
  };
  private localAvailable = false;

  constructor(
    private readonly local: RouterBackend | null,
    private readonly cloud: RouterBackend,
    opts: RouterOptions = {},
  ) {
    this.threshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** 只有在安裝與檢查全部通過後才註冊本地後端。 */
  registerLocalReady(): void {
    if (this.local) this.localAvailable = true;
  }

  isLocalUsable(): boolean {
    return this.localAvailable && this.local !== null && this.now() >= this.health.local.pausedUntil;
  }

  getHealth(kind: BackendKind): Readonly<Health> {
    return { ...this.health[kind] };
  }

  async route<T>(task: TaskKind, payload: unknown): Promise<RouteResult<T>> {
    if (this.isLocalUsable() && this.local) {
      try {
        const value = await this.local.run<T>(task, payload);
        this.record('local', true);
        return { value, backend: 'local', fellBack: false };
      } catch {
        this.record('local', false);
        const value = await this.runCloud<T>(task, payload);
        return { value, backend: 'cloud', fellBack: true };
      }
    }
    const value = await this.runCloud<T>(task, payload);
    return { value, backend: 'cloud', fellBack: false };
  }

  private async runCloud<T>(task: TaskKind, payload: unknown): Promise<T> {
    try {
      const v = await this.cloud.run<T>(task, payload);
      this.record('cloud', true);
      return v;
    } catch (e) {
      this.record('cloud', false);
      throw e;
    }
  }

  private record(kind: BackendKind, ok: boolean): void {
    const h = this.health[kind];
    if (ok) {
      h.successes++;
      h.consecutiveFailures = 0;
      return;
    }
    h.failures++;
    h.consecutiveFailures++;
    if (kind === 'local' && h.consecutiveFailures >= this.threshold) {
      h.pausedUntil = this.now() + this.cooldownMs;
      h.consecutiveFailures = 0;
    }
  }
}
