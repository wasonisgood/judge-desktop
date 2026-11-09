// 顯卡資訊的解析（純函式，不做 I/O）：lspci（Linux）、nvidia-smi（NVIDIA 顯存）、system_profiler（macOS）。
// 輸出格式與 parseHardware 的 gpus 欄位相同（名稱與顯示記憶體位元組），因此可直接餵給 parseHardware。

export interface GpuEntry {
  name: string;
  /** 顯示記憶體（位元組）；集成或共用記憶體為 0。 */
  adapterRamBytes: number;
}

const GB = 1024 ** 3;

/**
 * 解析 `lspci -mm` 的輸出，取出顯示控制器（VGA、3D、Display）。
 * 每行格式（-mm）：`00:02.0 "VGA compatible controller" "Intel Corporation" "UHD Graphics" ...`
 */
export function parseLspciGpus(stdout: string): GpuEntry[] {
  const out: GpuEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!/(VGA compatible controller|3D controller|Display controller)/i.test(line)) continue;
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    // quoted[0]=類別，quoted[1]=廠商，quoted[2]=型號
    const vendor = quoted[1] ?? '';
    const model = quoted[2] ?? '';
    const name = `${vendor} ${model}`.trim();
    if (name) out.push({ name, adapterRamBytes: 0 });
  }
  return out;
}

/**
 * 解析 `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` 的輸出（MiB）。
 * 每行：`NVIDIA GeForce RTX 3060, 12288`
 */
export function parseNvidiaSmi(stdout: string): GpuEntry[] {
  const out: GpuEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 2 || !parts[0]) continue;
    const mib = Number(parts[1]);
    out.push({ name: parts[0], adapterRamBytes: Number.isFinite(mib) && mib > 0 ? mib * 1024 * 1024 : 0 });
  }
  return out;
}

/**
 * 解析 `system_profiler SPDisplaysDataType -json` 的輸出。
 * Apple Silicon 的 GPU 以共用記憶體運作，sppci_vram 通常缺席，因此顯存記為 0（由 planLocalAI 視為統一記憶體）。
 */
export function parseSystemProfilerGpus(json: string): GpuEntry[] {
  let data: any;
  try { data = JSON.parse(json); } catch { return []; }
  const items: any[] = Array.isArray(data?.SPDisplaysDataType) ? data.SPDisplaysDataType : [];
  const out: GpuEntry[] = [];
  for (const it of items) {
    const name = String(it?._name ?? it?.sppci_model ?? '').trim();
    if (!name) continue;
    const vramText = String(it?.spdisplays_vram ?? it?.spdisplays_vram_shared ?? '');
    const m = /(\d+(?:\.\d+)?)\s*(GB|MB)/i.exec(vramText);
    let bytes = 0;
    if (m) bytes = Number(m[1]) * (m[2].toUpperCase() === 'GB' ? GB : 1024 * 1024);
    out.push({ name, adapterRamBytes: bytes });
  }
  return out;
}
