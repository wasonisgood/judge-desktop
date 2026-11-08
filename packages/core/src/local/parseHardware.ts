// 把 PowerShell 查詢到的硬體資訊（JSON）轉成 HardwareInfo。純函式，方便測試。
import type { HardwareInfo } from './hardware';

export interface RawHardwareJson {
  /** Win32_ComputerSystem.TotalPhysicalMemory（位元組）。 */
  totalMemoryBytes?: number | string | null;
  /** 安裝磁碟可用空間（位元組）。 */
  freeDiskBytes?: number | string | null;
  /** Win32_VideoController 的名稱與顯示記憶體（位元組，可能是陣列）。 */
  gpus?: { name?: string | null; adapterRamBytes?: number | string | null }[] | null;
}

const GB = 1024 ** 3;

function toGB(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor((n / GB) * 10) / 10 : 0;
}

/** 由 GPU 名稱判斷廠商。沒有名稱為 none；有名稱但不認識為 other（仍是一張顯卡，只是不被 Ollama 加速）。 */
export function detectGpuVendor(name: string | null | undefined): HardwareInfo['gpuVendor'] {
  const raw = (name ?? '').trim();
  if (!raw) return 'none';
  const s = raw.toLowerCase();
  if (s.includes('nvidia') || s.includes('geforce') || s.includes('rtx') || s.includes('gtx') || s.includes('quadro')) return 'nvidia';
  if (s.includes('amd') || s.includes('radeon')) return 'amd';
  if (s.includes('intel')) return 'intel';
  if (s.includes('qualcomm') || s.includes('adreno')) return 'qualcomm';
  if (s.includes('apple')) return 'apple';
  return 'other';
}

/** Ollama 在 Windows 上會用來加速的獨立顯卡廠商（其餘即使存在也以 CPU 執行）。 */
export function isAcceleratorVendor(v: HardwareInfo['gpuVendor']): boolean {
  return v === 'nvidia' || v === 'amd';
}

/**
 * 解析硬體 JSON。顯卡取「顯示記憶體最大」的那一張作為判斷依據。
 * 注意：Windows 的 AdapterRAM 為 32 位元欄位，超過 4 GB 會溢位；這種情況下數值不可靠，
 * 呼叫端應以 PowerShell 的登錄檔值或 nvidia-smi 另外確認，此處保守地照實解析。
 */
export function parseHardware(raw: RawHardwareJson): HardwareInfo {
  const gpus = Array.isArray(raw.gpus) ? raw.gpus : raw.gpus ? [raw.gpus] : [];
  let best: { vendor: HardwareInfo['gpuVendor']; vram: number; name: string | null } = { vendor: 'none', vram: 0, name: null };
  for (const g of gpus) {
    const vendor = detectGpuVendor(g.name);
    if (vendor === 'none') continue;
    const vram = toGB(g.adapterRamBytes);
    // 優先選擇有獨立顯存的顯卡；都沒有時取第一張有名稱的顯卡（集成顯卡）。
    if (best.vendor === 'none' || vram > best.vram) best = { vendor, vram, name: (g.name ?? '').trim() || null };
  }
  return {
    ramGB: toGB(raw.totalMemoryBytes),
    freeDiskGB: toGB(raw.freeDiskBytes),
    vramGB: best.vram,
    gpuVendor: best.vendor,
    gpuName: best.name,
    // 注意：AdapterRAM 為 0 通常代表共用系統記憶體（集成顯卡），不代表沒有顯卡。
    gpuMemoryShared: best.vendor !== 'none' && best.vram === 0,
  };
}
