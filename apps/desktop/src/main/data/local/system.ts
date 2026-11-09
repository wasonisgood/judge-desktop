// 本地資料層：系統資訊（唯讀）：CPU 架構、硬體、數位簽章。
// Windows 以 PowerShell（Win32_Processor、Win32_ComputerSystem、Get-AuthenticodeSignature）查詢；
// macOS 以 sysctl、df；Linux 以 /proc/meminfo、uname、df。所有查詢都只讀取，不改動系統。
import { spawn, execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import {
  nativeArchFromWmi, parseHardware, parseSignatureJson, archFromNodeArch, archFromUname,
  parseLspciGpus, parseNvidiaSmi, parseSystemProfilerGpus,
  type HardwareInfo, type NativeArch, type GpuEntry,
} from '@judge/core';

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

/** 執行唯讀的系統指令（不經過 shell）。 */
export function runCommand(bin: string, args: string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(new Error(`系統查詢失敗（${bin}）：${err.message}`));
      else resolve(stdout.trim());
    });
  });
}

/** 解析 `df -Pk` 的輸出，回傳可用空間（位元組）。第二行第四欄為可用的 1K 區塊數。 */
export function parseDfAvailableBytes(stdout: string): number {
  const line = stdout.trim().split(/\r?\n/)[1] ?? '';
  const kb = Number(line.trim().split(/\s+/)[3]);
  if (!Number.isFinite(kb) || kb <= 0) throw new Error('無法解析磁碟可用空間');
  return kb * 1024;
}

/** 解析 /proc/meminfo 的 MemTotal（kB），回傳位元組。 */
export function parseMemTotalBytes(meminfo: string): number {
  const m = /^MemTotal:\s+(\d+)\s+kB/m.exec(meminfo);
  if (!m) throw new Error('無法解析 MemTotal');
  return Number(m[1]) * 1024;
}

/** 原生 CPU 架構（不是模擬後的 process.arch；ARM64 上 Node/Electron 可能是模擬執行）。 */
export async function detectNativeArch(): Promise<NativeArch> {
  if (process.platform === 'win32') {
    const raw = await runPowerShell('(Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture');
    return nativeArchFromWmi(raw.trim());
  }
  if (process.platform === 'darwin') {
    // Apple Silicon 上即使是 Rosetta 轉譯的 Node，hw.optional.arm64 仍為 1，因此以它為準。
    try {
      const arm = await runCommand('sysctl', ['-n', 'hw.optional.arm64']);
      if (arm === '1') return 'arm64';
    } catch { /* 舊版 macOS 沒有此鍵，改用 uname */ }
    return archFromUname(await runCommand('uname', ['-m']));
  }
  if (process.platform === 'linux') return archFromUname(await runCommand('uname', ['-m']));
  return archFromNodeArch(process.arch);
}

async function freeDiskBytes(): Promise<number> {
  if (process.platform === 'win32') {
    return 0; // Windows 以 PowerShell 查詢（見 detectHardware）
  }
  return parseDfAvailableBytes(await runCommand('df', ['-Pk', os.homedir()]));
}

export async function detectHardware(): Promise<HardwareInfo> {
  if (process.platform === 'win32') {
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
  if (process.platform === 'darwin') {
    const totalMemoryBytes = Number(await runCommand('sysctl', ['-n', 'hw.memsize']));
    return parseHardware({ totalMemoryBytes, freeDiskBytes: await freeDiskBytes(), gpus: await macGpus() });
  }
  if (process.platform === 'linux') {
    const totalMemoryBytes = parseMemTotalBytes(await fs.readFile('/proc/meminfo', 'utf8'));
    return parseHardware({ totalMemoryBytes, freeDiskBytes: await freeDiskBytes(), gpus: await linuxGpus() });
  }
  throw new Error('本地 AI 不支援此作業系統');
}

/**
 * macOS 顯卡：system_profiler 取得名稱；Apple Silicon 的 GPU 以統一記憶體運作（Metal 加速），
 * 即使 system_profiler 失敗，也以原生架構為 arm64 時補上 Apple GPU。查詢失敗不會中斷偵測。
 */
async function macGpus(): Promise<GpuEntry[]> {
  let gpus: GpuEntry[] = [];
  try {
    gpus = parseSystemProfilerGpus(await runCommand('system_profiler', ['SPDisplaysDataType', '-json'], 30_000));
  } catch { /* 查詢失敗：改用架構判斷 */ }
  if (gpus.length === 0 && (await detectNativeArch()) === 'arm64') {
    gpus = [{ name: 'Apple GPU', adapterRamBytes: 0 }];
  }
  return gpus;
}

/**
 * Linux 顯卡：lspci 取得廠商與型號；NVIDIA 另以 nvidia-smi 取得顯存；AMD 以 amdgpu 的 sysfs 取得顯存。
 * 任一工具不存在都只是少了資訊，不會中斷偵測。
 */
async function linuxGpus(): Promise<GpuEntry[]> {
  const gpus: GpuEntry[] = [];
  try {
    gpus.push(...parseNvidiaSmi(await runCommand('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])));
  } catch { /* 沒有 NVIDIA 驅動 */ }
  let lspci: GpuEntry[] = [];
  try {
    lspci = parseLspciGpus(await runCommand('lspci', ['-mm']));
  } catch { /* 沒有 pciutils */ }
  const hasNvidia = gpus.length > 0;
  const amdVram = await amdgpuVramBytes();
  for (const g of lspci) {
    if (/nvidia/i.test(g.name) && hasNvidia) continue; // 已由 nvidia-smi 取得
    if (/amd|ati|radeon/i.test(g.name) && amdVram > 0) g.adapterRamBytes = amdVram;
    gpus.push(g);
  }
  return gpus;
}

/** amdgpu 驅動的顯存（sysfs），取所有 AMD 顯卡中最大的一個；讀不到回傳 0。 */
async function amdgpuVramBytes(): Promise<number> {
  let best = 0;
  try {
    for (const card of await fs.readdir('/sys/class/drm')) {
      if (!/^card\d+$/.test(card)) continue;
      try {
        const v = Number((await fs.readFile(`/sys/class/drm/${card}/device/mem_info_vram_total`, 'utf8')).trim());
        if (Number.isFinite(v) && v > best) best = v;
      } catch { /* 非 amdgpu */ }
    }
  } catch { /* 沒有 drm */ }
  return best;
}

/** Windows 的 Authenticode 簽章狀態；其他作業系統不檢查（回傳 null）。 */
export async function authenticodeStatus(file: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const script = `Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}' | Select-Object @{n='Status';e={$_.Status.ToString()}}, @{n='Subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`;
  return parseSignatureJson(await runPowerShell(script)).status;
}
