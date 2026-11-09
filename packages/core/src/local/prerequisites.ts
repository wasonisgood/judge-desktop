// 系統前置工具檢查（Linux／macOS）：安裝引擎與讀取硬體需要的指令。純函式，不做 I/O。
// 桌面端負責實際檢查（執行指令、讀取 /etc/os-release）；這裡只決定缺少什麼、以及各發行版的安裝指令。

/** 安裝與偵測本地引擎需要的系統工具。tar 用來解開引擎；df 用來讀取磁碟空間。 */
export const REQUIRED_TOOLS = ['tar', 'df'] as const;
export type RequiredTool = (typeof REQUIRED_TOOLS)[number];

/** 從 /etc/os-release 的內容取得發行版識別碼（ID），無法判斷時回傳 null。 */
export function distroIdFromOsRelease(text: string): string | null {
  const m = /^ID=["']?([a-z0-9._-]+)["']?\s*$/m.exec(text);
  return m ? m[1] : null;
}

/** 依發行版給出安裝指令；未知發行版給出通用說明。 */
export function installCommandFor(distroId: string | null, tool: RequiredTool = 'tar'): string {
  const pkg = tool === 'df' ? 'coreutils' : 'tar';
  switch (distroId) {
    case 'debian':
    case 'ubuntu':
    case 'linuxmint':
    case 'pop':
    case 'raspbian':
      return `sudo apt install ${pkg}`;
    case 'fedora':
    case 'rhel':
    case 'centos':
    case 'rocky':
    case 'almalinux':
      return `sudo dnf install ${pkg}`;
    case 'opensuse-leap':
    case 'opensuse-tumbleweed':
    case 'sles':
      return `sudo zypper install ${pkg}`;
    case 'arch':
    case 'manjaro':
    case 'endeavouros':
      return `sudo pacman -S ${pkg}`;
    case 'alpine':
      return `sudo apk add ${pkg}`;
    default:
      return `請使用此系統的套件管理程式安裝 ${pkg}`;
  }
}

/**
 * 產生使用者看得懂的修復步驟（繁體中文）。missing 為空時回傳空陣列。
 * 這些步驟會顯示在模組安裝精靈的失敗說明中。
 */
export function prerequisiteSteps(missing: readonly RequiredTool[], distroId: string | null): string[] {
  if (missing.length === 0) return [];
  const names = missing.join('、');
  const steps = [`缺少系統工具：${names}。請先安裝後再按「重試」。`];
  for (const tool of missing) steps.push(`安裝指令：${installCommandFor(distroId, tool)}`);
  return steps;
}

/** 解析 `tar --version` 的輸出，確認是 tar（GNU 或 bsdtar）。 */
export function isTarVersionOutput(stdout: string): boolean {
  return /\b(GNU tar|bsdtar|tar \(GNU tar\))/i.test(stdout) || /^tar/i.test(stdout.trim());
}
