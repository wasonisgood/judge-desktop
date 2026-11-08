// 工作負載身分聯合（Workload Identity Federation）：以使用者提供的 OIDC 身分憑證（JWT）
// 換取短期存取權杖，取代長期的 API 金鑰。規格來源：Anthropic 官方 WIF 參考文件。
//   POST {baseUrl}/v1/oauth/token （JSON）
//   { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion, federation_rule_id,
//     organization_id, service_account_id, workspace_id? }
//   回應：{ access_token, token_type: "Bearer", expires_in, scope }
// 刷新時機：到期前 120 秒為建議刷新，30 秒內為必須刷新（與官方 SDK 一致）。
// 權杖只存在記憶體中，不寫入磁碟。

export interface FederationConfig {
  baseUrl: string;
  organizationId: string;
  federationRuleId: string;
  serviceAccountId: string;
  /** 工作區 ID；規則涵蓋多個工作區時必填。 */
  workspaceId?: string;
}

export interface FederatedToken {
  accessToken: string;
  /** 到期時間（毫秒時間戳）。 */
  expiresAt: number;
  scope?: string;
}

export interface ExchangeOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export const WIF_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const ADVISORY_REFRESH_MS = 120_000;
export const MANDATORY_REFRESH_MS = 30_000;

/** 以身分憑證（JWT）換取存取權杖。失敗時拋出包含狀態碼與伺服器訊息的錯誤。 */
export async function exchangeFederatedToken(
  cfg: FederationConfig,
  assertion: string,
  opts: ExchangeOptions = {},
): Promise<FederatedToken> {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const body: Record<string, string> = {
    grant_type: WIF_GRANT_TYPE,
    assertion,
    federation_rule_id: cfg.federationRuleId,
    organization_id: cfg.organizationId,
    service_account_id: cfg.serviceAccountId,
  };
  if (cfg.workspaceId) body.workspace_id = cfg.workspaceId;

  const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error_description ?? json?.error?.message ?? json?.error ?? '未知錯誤';
    throw new Error(`工作負載身分聯合失敗（HTTP ${res.status}）：${msg}`);
  }
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new Error('工作負載身分聯合失敗：回應沒有 access_token');
  }
  const expiresIn = Number(json.expires_in) || 0;
  return { accessToken: json.access_token, expiresAt: now() + expiresIn * 1000, scope: json.scope };
}

/**
 * 權杖快取：未到期且離到期還有一段時間時重複使用；快到期時重新換取。
 * 同時只會有一個換取請求在進行（避免重複消耗身分憑證的 jti）。
 */
export class FederatedTokenProvider {
  private token: FederatedToken | null = null;
  private inflight: Promise<FederatedToken> | null = null;

  constructor(
    private readonly cfg: FederationConfig,
    private readonly readAssertion: () => Promise<string>,
    private readonly opts: ExchangeOptions = {},
  ) {}

  /** 目前是否需要刷新（距到期不足建議刷新時間）。 */
  needsRefresh(now: number = (this.opts.now ?? Date.now)()): boolean {
    if (!this.token) return true;
    return this.token.expiresAt - now <= ADVISORY_REFRESH_MS;
  }

  async get(): Promise<string> {
    const now = (this.opts.now ?? Date.now)();
    if (this.token && this.token.expiresAt - now > MANDATORY_REFRESH_MS && !this.needsRefresh(now)) {
      return this.token.accessToken;
    }
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          const assertion = await this.readAssertion();
          const t = await exchangeFederatedToken(this.cfg, assertion, this.opts);
          this.token = t;
          return t;
        } finally {
          this.inflight = null;
        }
      })();
    }
    return (await this.inflight).accessToken;
  }

  /** 清除快取（例如設定變更後）。 */
  reset(): void {
    this.token = null;
  }
}
