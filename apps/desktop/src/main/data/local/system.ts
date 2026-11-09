// 本地資料層：Windows 系統資訊（唯讀）：CPU 架構、硬體、數位簽章。以 PowerShell 查詢。
import { spawn } from 'node:child_process';
import { nativeArchFromWmi, parseHardware, parseSignatureJson, type HardwareInfo, type NativeArch } from '@judge/core';

export function runPowerShell(script: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('系統查詢逾時')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`系統查詢失敗（代碼 ${code}）：${err.slice(0, 200)}`));
    });
  });
}

/** 原生 CPU 架構（不是模擬後的 process.arch；ARM64 上 Node/Electron 是模擬執行）。 */
export async function detectNativeArch(): Promise<NativeArch> {
  if (process.platform !== 'win32') return 'unknown';
  const raw = await runPowerShell('(Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture');
  return nativeArchFromWmi(raw.trim());
}

export async function detectHardware(): Promise<HardwareInfo> {
  if (process.platform !== 'win32') throw new Error('本地 AI 目前只支援 Windows');
  const script = [
    '$cs = Get-CimInstance Win32_ComputerSystem',
    '$gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM)',
    '$free = (Get-PSDrive -Name ($env:SystemDrive.TrimEnd(":"))).Free',
    '[pscustomobject]@{ totalMemoryBytes = $cs.TotalPhysicalMemory; freeDiskBytes = $free;',
    '  gpus = @($gpu | ForEach-Object { [pscustomobject]@{ name = $_.Name; adapterRamBytes = $_.AdapterRAM } }) } | ConvertTo-Json -Depth 4 -Compress',
  ].join('\n');
  const raw = JSON.parse(await runPowerShell(script));
  return parseHardware({ totalMemoryBytes: raw.totalMemoryBytes, freeDiskBytes: raw.freeDiskBytes, gpus: raw.gpus });
}

export async function authenticodeStatus(file: string): Promise<string> {
  const script = `Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}' | Select-Object @{n='Status';e={$_.Status.ToString()}}, @{n='Subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`;
  return parseSignatureJson(await runPowerShell(script)).status;
}
