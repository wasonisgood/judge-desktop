// CPU 架構判讀與 Ollama 安裝資產選擇。
// 注意：Node／Electron 在 ARM64 Windows 上多半以 x64 模擬執行，process.arch 與 PROCESSOR_ARCHITECTURE 會誤報。
// 因此架構一律以 Win32_Processor.Architecture（原生值）判斷：0=x86、5=ARM、9=x64、12=ARM64。

export type NativeArch = 'arm64' | 'x64' | 'x86' | 'arm32' | 'unknown';

export function nativeArchFromWmi(code: number | string | null | undefined): NativeArch {
  // 注意：Number(null) 會得到 0（x86），因此空值要先排除。
  if (code === null || code === undefined || code === '') return 'unknown';
  const n = Number(code);
  switch (n) {
    case 12:
      return 'arm64';
    case 9:
      return 'x64';
    case 0:
      return 'x86';
    case 5:
      return 'arm32';
    default:
      return 'unknown';
  }
}

export type EnginePlatform = 'win32' | 'darwin' | 'linux';

/**
 * Ollama 官方發佈資產名稱（與 GitHub release 的檔名一致）。
 * - Windows：zip（免安裝），分 arm64 與 amd64。
 * - macOS：單一通用檔 ollama-darwin.tgz（同時含 Apple Silicon 與 Intel）。
 * - Linux：tar.zst（需要系統的 zstd），分 arm64 與 amd64。
 * ARM32 與未知架構不支援。
 */
export function ollamaAssetFor(arch: NativeArch, platform: EnginePlatform = 'win32', gpuVendor: string = 'none'): string | null {
  if (platform === 'win32') {
    if (arch === 'arm64') return 'ollama-windows-arm64.zip';
    if (arch === 'x64') return 'ollama-windows-amd64.zip';
    return null;
  }
  if (platform === 'darwin') {
    return arch === 'arm64' || arch === 'x64' ? 'ollama-darwin.tgz' : null;
  }
  // Linux：AMD 獨立顯卡需要 ROCm 版本的執行環境；NVIDIA 與其餘情況使用基本版（內含 CUDA 函式庫）。
  if (arch === 'x64') return gpuVendor === 'amd' ? 'ollama-linux-amd64-rocm.tar.zst' : 'ollama-linux-amd64.tar.zst';
  if (arch === 'arm64') return 'ollama-linux-arm64.tar.zst';
  return null;
}

/** 解壓後的執行檔名稱。 */
export function ollamaExeName(platform: EnginePlatform = 'win32'): string {
  return platform === 'win32' ? 'ollama.exe' : 'ollama';
}

/** 依資產檔名判斷壓縮格式：決定要用 zip 或系統的 tar 解壓。 */
export function archiveKindFor(assetName: string): 'zip' | 'tgz' | 'tar.zst' {
  if (assetName.endsWith('.zip')) return 'zip';
  if (assetName.endsWith('.tar.zst')) return 'tar.zst';
  return 'tgz';
}

/** Node 的 process.arch（僅在非 Windows 使用；macOS 上請改用 sysctl 判斷原生架構）。 */
export function archFromNodeArch(nodeArch: string): NativeArch {
  if (nodeArch === 'arm64') return 'arm64';
  if (nodeArch === 'x64') return 'x64';
  if (nodeArch === 'ia32') return 'x86';
  if (nodeArch === 'arm') return 'arm32';
  return 'unknown';
}

/** Linux 的 `uname -m` 輸出轉換為架構。 */
export function archFromUname(machine: string): NativeArch {
  const m = machine.trim();
  if (m === 'aarch64' || m === 'arm64') return 'arm64';
  if (m === 'x86_64' || m === 'amd64') return 'x64';
  if (/^i[3-6]86$/.test(m)) return 'x86';
  if (/^armv[67]/.test(m)) return 'arm32';
  return 'unknown';
}

/** 引擎與系統架構是否相符（相符才是原生速度；不符代表模擬執行，應提醒使用者）。 */
export function archMatches(engineArch: NativeArch | null, nativeArch: NativeArch): boolean | null {
  if (!engineArch || nativeArch === 'unknown') return null;
  return engineArch === nativeArch;
}
