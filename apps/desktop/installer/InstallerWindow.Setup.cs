using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Win32;
using JudgeResearch;

namespace JudgeResearchInstaller {
    public partial class InstallerWindow {
        private void DetectExistingInstall() {
            try {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JudgeResearch")) {
                    if (key != null) {
                        string loc = key.GetValue("InstallLocation") as string;
                        if (!string.IsNullOrEmpty(loc) && Directory.Exists(loc)) {
                            existingInstallDir = loc;
                            txtInstallPath.Text = loc;
                            installedVersion = key.GetValue("DisplayVersion") as string;
                            if (!string.IsNullOrEmpty(installedVersion)) {
                                if (UpdateCommon.IsNewer(BuildInfo.Version, installedVersion)) {
                                    isUpgrade = true;
                                } else {
                                    isRepairMode = true;
                                }
                            } else {
                                isRepairMode = true;
                            }
                        }
                    }
                }
            } catch { }

            if (existingInstallDir == null) {
                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string defaultPath = Path.Combine(localApp, "JudgeResearch");
                if (Directory.Exists(defaultPath)) {
                    existingInstallDir = defaultPath;
                    txtInstallPath.Text = defaultPath;
                    isRepairMode = true;
                }
            }
        }

        private static string PrecheckTarget(string dir, bool en) {
            try {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, ".write-test-" + Guid.NewGuid().ToString("N"));
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
            } catch (Exception ex) {
                UpdateCommon.Log("Write probe failed: " + ex);
                return en
                    ? "Cannot write to directory:\n" + dir + "\n\nPlease use default path or run as administrator."
                    : "無法寫入此目錄：\n" + dir + "\n\n請改用預設安裝目錄（%LocalAppData%\\JudgeResearchDesk），或以系統管理員身分執行。";
            }

            try {
                DriveInfo drive = new DriveInfo(Path.GetPathRoot(dir));
                long need = 300L * 1024 * 1024;
                if (drive.IsReady && drive.AvailableFreeSpace < need) {
                    long freeMb = drive.AvailableFreeSpace / 1024 / 1024;
                    return en
                        ? string.Format("Insufficient disk space ({0} MB free / approx 300 MB required).", freeMb)
                        : string.Format("磁碟空間不足（剩餘 {0} MB，需要約 300 MB）。請清出空間或改選其他磁碟。", freeMb);
                }
            } catch { }
            return null;
        }

        private void StopRunningApp() {
            try {
                foreach (Process p in Process.GetProcessesByName("JudgeResearchUpdater")) {
                    try { if (!p.WaitForExit(3000)) { p.Kill(); p.WaitForExit(2000); } } catch { }
                }
            } catch { }
            try {
                foreach (Process p in Process.GetProcessesByName("JudgeResearch")) {
                    try { p.Kill(); p.WaitForExit(3000); } catch { }
                }
            } catch { }
            try {
                foreach (Process p in Process.GetProcessesByName("司法院裁判研究")) {
                    try { p.Kill(); p.WaitForExit(3000); } catch { }
                }
            } catch { }
        }

    }
}
