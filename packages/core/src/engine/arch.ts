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

/** Ollama 官方 Windows 資產名稱（zip，免安裝）。ARM32 與未知架構不支援。 */
export function ollamaAssetFor(arch: NativeArch): string | null {
  if (arch === 'arm64') return 'ollama-windows-arm64.zip';
  if (arch === 'x64') return 'ollama-windows-amd64.zip';
  return null;
}

/** 引擎與系統架構是否相符（相符才是原生速度；不符代表模擬執行，應提醒使用者）。 */
export function archMatches(engineArch: NativeArch | null, nativeArch: NativeArch): boolean | null {
  if (!engineArch || nativeArch === 'unknown') return null;
  return engineArch === nativeArch;
}
