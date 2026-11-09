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
        private static void ExtractWithRetry(ZipArchiveEntry entry, string dest, bool en) {
            for (int attempt = 1; ; attempt++) {
                try {
                    entry.ExtractToFile(dest, true);
                    return;
                } catch (IOException) {
                    if (attempt >= 15) {
                        throw new IOException(en
                            ? "A file is still in use by another program:\n" + dest + "\n\nClose Judge Research and its updater, then run the installer again."
                            : "檔案仍被其他程序占用：\n" + dest + "\n\n請關閉「司法院裁判研究」與其更新程式後，重新執行安裝程式。");
                    }
                    Thread.Sleep(1000);
                }
            }
        }

        // 估算安裝所需空間（內嵌 payload 解壓後大小 + 10% 餘量；讀取失敗時使用 300 MB）
        private static long RequiredMb() {
            try {
                using (Stream zs = Assembly.GetExecutingAssembly().GetManifestResourceStream("app-payload.zip")) {
                    if (zs == null) return 300;
                    using (ZipArchive za = new ZipArchive(zs, ZipArchiveMode.Read)) {
                        long total = 0;
                        foreach (ZipArchiveEntry e in za.Entries) total += e.Length;
                        return Math.Max(50, (long)Math.Ceiling(total * 1.1 / 1048576.0));
                    }
                }
            } catch { return 300; }
        }

        private static string GetMainExePath(string dir) {
            string p1 = Path.Combine(dir, "司法院裁判研究.exe");
            if (File.Exists(p1)) return p1;
            string p2 = Path.Combine(dir, "JudgeResearch.exe");
            if (File.Exists(p2)) return p2;
            try {
                foreach (string f in Directory.GetFiles(dir, "*.exe")) {
                    string n = Path.GetFileName(f).ToLowerInvariant();
                    if (!n.Contains("setup") && !n.Contains("uninstall") && !n.Contains("updater")) {
                        return f;
                    }
                }
            } catch { }
            return p1;
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description) {
            try {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = workingDir;
                shortcut.IconLocation = targetPath + ",0";
                shortcut.Description = description;
                shortcut.Save();
            } catch { }
        }

        private static void LaunchInstalledApp(string installDir) {
            string exe = GetMainExePath(installDir);
            if (File.Exists(exe)) {
                try { Process.Start(exe); } catch { }
            }
            Environment.Exit(0);
        }
    }
}
