// 排除問題（診斷）：把「觀測到的事實」轉成檢查表，每一項都有 通過／警告／失敗、說明，與對應的修復動作。
// 這裡是純函式：事實由桌面端收集（服務、模型、磁碟、網路、檔案雜湊…），這裡只負責判讀。
import type { NativeArch } from './arch';
import { archMatches } from './arch';
import type { RepairActionId } from './repair';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface DiagFacts {
  nativeArch: NativeArch;
  /** 已安裝引擎的架構；尚未安裝為 null。 */
  engineArch: NativeArch | null;
  /** 引擎執行檔的 SHA-256 是否與安裝時記錄的相符；未記錄為 null。 */
  engineFileOk: boolean | null;
  /** Authenticode 簽章狀態（例如 Valid、NotSigned）；未檢查為 null。 */
  engineSignature: string | null;
  serviceVersion: string | null;
  requiredModels: string[];
  installedModels: string[];
  /** 實際送一則小訊息的結果；未測試為 null。 */
  chatSmokeOk: boolean | null;
  freeDiskGB: number;
  requiredDiskGB: number;
  network: { general: boolean | null; judicial: boolean | null };
  /** AI 引擎模組的登錄狀態。 */
  moduleStatus: string;
  /** 最近一次失敗（代碼與階段），沒有則為 null。 */
  recentFailure: { code: string; stage: string } | null;
  /** 是否在本次檢查中有提供所選方案（沒有方案則不檢查模型）。 */
  hasPlan: boolean;
}

export interface DiagCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  /** 可自動執行的修復動作；需要使用者自行處理時為 null（並在 detail 說明）。 */
  fix: RepairActionId | null;
}

export interface DiagSummary {
  overall: CheckStatus;
  checks: DiagCheck[];
}

export function runDiagnostics(f: DiagFacts): DiagCheck[] {
  const out: DiagCheck[] = [];
  const add = (c: DiagCheck) => out.push(c);

  // 1. 引擎是否已安裝、架構是否與系統相符
  if (!f.engineArch) {
    add({ id: 'engine-installed', title: '本地服務引擎', status: 'warn', detail: '尚未安裝本地服務引擎。', fix: 'reinstall-engine' });
  } else {
    const m = archMatches(f.engineArch, f.nativeArch);
    if (m === false) {
      add({
        id: 'engine-arch', title: '引擎架構', status: 'warn',
        detail: `引擎為 ${f.engineArch}，但系統為 ${f.nativeArch}，會以模擬方式執行，速度明顯較慢。請重新安裝對應架構的引擎。`,
        fix: 'reinstall-engine',
      });
    } else {
      add({ id: 'engine-arch', title: '引擎架構', status: 'pass', detail: `引擎 ${f.engineArch} 與系統 ${f.nativeArch} 相符。`, fix: null });
    }
    if (f.engineFileOk === false) {
      add({ id: 'engine-file', title: '引擎檔案完整性', status: 'fail', detail: '引擎執行檔與安裝時的 SHA-256 不符，檔案可能損毀或被修改。', fix: 'reinstall-engine' });
    } else if (f.engineFileOk === null) {
      add({ id: 'engine-file', title: '引擎檔案完整性', status: 'warn', detail: '沒有安裝時的校驗紀錄，無法確認檔案完整性。', fix: 'reinstall-engine' });
    } else {
      add({ id: 'engine-file', title: '引擎檔案完整性', status: 'pass', detail: 'SHA-256 與安裝時相符。', fix: null });
    }
    if (f.engineSignature === 'Valid') {
      add({ id: 'engine-signature', title: '引擎數位簽章', status: 'pass', detail: '簽章有效。', fix: null });
    } else {
      add({
        id: 'engine-signature', title: '引擎數位簽章', status: 'warn',
        detail: `簽章狀態：${f.engineSignature ?? '未檢查'}。官方 zip 版本不一定有簽章；檔案完整性以 SHA-256 為準。`,
        fix: null,
      });
    }
  }

  // 2. 服務是否回應
  if (f.serviceVersion) {
    add({ id: 'service', title: '本地服務運作', status: 'pass', detail: `服務回應正常（版本 ${f.serviceVersion}）。`, fix: null });
  } else {
    add({ id: 'service', title: '本地服務運作', status: 'fail', detail: '本地服務沒有回應。', fix: 'restart-service' });
  }

  // 3. 模型是否齊全（只有有方案時才檢查）
  if (f.hasPlan) {
    const missing = f.requiredModels.filter((m) => !f.installedModels.includes(m));
    if (missing.length) {
      add({ id: 'models', title: '模型檔案', status: 'fail', detail: `缺少模型：${missing.join('、')}。`, fix: 'repull-models' });
    } else {
      add({ id: 'models', title: '模型檔案', status: 'pass', detail: `所需模型皆已安裝（${f.requiredModels.join('、')}）。`, fix: null });
    }
  }

  // 4. 模型能否實際回應
  if (f.chatSmokeOk === true) add({ id: 'chat', title: '模型回應測試', status: 'pass', detail: '模型能正常生成回答。', fix: null });
  else if (f.chatSmokeOk === false) add({ id: 'chat', title: '模型回應測試', status: 'fail', detail: '模型無法生成回答。', fix: 'repull-models' });
  else add({ id: 'chat', title: '模型回應測試', status: 'warn', detail: '尚未測試。', fix: null });

  // 5. 磁碟空間
  if (f.requiredDiskGB > 0 && f.freeDiskGB < f.requiredDiskGB) {
    add({ id: 'disk', title: '磁碟空間', status: 'fail', detail: `可用 ${f.freeDiskGB} GB，所需約 ${f.requiredDiskGB} GB。請清出空間後再重試。`, fix: 'free-disk-space' });
  } else {
    add({ id: 'disk', title: '磁碟空間', status: 'pass', detail: `可用 ${f.freeDiskGB} GB。`, fix: null });
  }

  // 6. 網路：一般網路（警告）與司法院（失敗，影響檢索）
  if (f.network.general === false) {
    add({ id: 'net-general', title: '一般網路', status: 'warn', detail: '一般網路無法連線；下載模型可能失敗。', fix: 'retry' });
  } else if (f.network.general === true) {
    add({ id: 'net-general', title: '一般網路', status: 'pass', detail: '一般網路可連線。', fix: null });
  }
  if (f.network.judicial === false) {
    add({ id: 'net-judicial', title: '司法院網站連線', status: 'fail', detail: '無法連到司法院網站。若使用 VPN，請切換節點或暫時關閉後重試。', fix: 'check-network-vpn' });
  } else if (f.network.judicial === true) {
    add({ id: 'net-judicial', title: '司法院網站連線', status: 'pass', detail: '可連到司法院網站。', fix: null });
  }

  // 7. 模組註冊與最近失敗
  if (f.moduleStatus === 'failed') {
    add({ id: 'module', title: '模組登錄狀態', status: 'fail', detail: '上次安裝失敗，模組未啟用。', fix: 'retry' });
  } else if (f.moduleStatus === 'ready') {
    add({ id: 'module', title: '模組登錄狀態', status: 'pass', detail: '模組已註冊並啟用。', fix: null });
  } else {
    add({ id: 'module', title: '模組登錄狀態', status: 'warn', detail: `模組狀態：${f.moduleStatus}。`, fix: null });
  }
  if (f.recentFailure) {
    add({ id: 'recent-failure', title: '最近一次失敗', status: 'warn', detail: `${f.recentFailure.code}（階段：${f.recentFailure.stage}）。可匯出診斷報告一併提供。`, fix: null });
  }

  return out;
}

export function summarize(checks: DiagCheck[]): DiagSummary {
  const overall: CheckStatus = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { overall, checks };
}

const LABEL: Record<CheckStatus, string> = { pass: '通過', warn: '警告', fail: '失敗' };

/** 產生給使用者保存或傳給開發者的純文字診斷報告（不含金鑰、路徑與個人資料）。 */
export function formatDiagnosticReport(s: DiagSummary, meta: { appVersion: string; moduleVersion: string | null; at: string; osVersion: string }): string {
  const lines = [
    `司法院裁判研究｜本地模組診斷報告`,
    `時間：${meta.at}`,
    `應用程式版本：${meta.appVersion}`,
    `AI 引擎模組版本：${meta.moduleVersion ?? '未安裝'}`,
    `作業系統：${meta.osVersion}`,
    `總結：${LABEL[s.overall]}`,
    '',
  ];
  for (const c of s.checks) {
    lines.push(`[${LABEL[c.status]}] ${c.title}：${c.detail}${c.fix ? `（建議修復：${c.fix}）` : ''}`);
  }
  return lines.join('\n');
}
