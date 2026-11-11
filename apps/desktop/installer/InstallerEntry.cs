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
    public static class InstallerOptions {
        public static string Lang = "zh";
        public static bool UpdateMode = false;
        public static bool NoSelfUpdate = false;
        // 只更新 App 本體時，更新程式以外部 payload zip 取代內嵌的 payload；AppVersion 為新的 App 版本號。
        public static string PayloadPath = null;
        public static string AppVersion = null;
    }

    public class App : Application {
        [STAThread]
        public static void Main(string[] args) {
            int oldPid = 0;
            if (args != null) {
                for (int i = 0; i < args.Length; i++) {
                    string a = args[i];
                    if (string.Equals(a, "--lang", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) {
                        InstallerOptions.Lang = args[++i];
                    } else if (string.Equals(a, "--update-mode", StringComparison.OrdinalIgnoreCase)) {
                        InstallerOptions.UpdateMode = true;
                    } else if (string.Equals(a, "--no-self-update", StringComparison.OrdinalIgnoreCase)) {
                        InstallerOptions.NoSelfUpdate = true;
                    } else if (string.Equals(a, "--payload", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) {
                        InstallerOptions.PayloadPath = args[++i];
                    } else if (string.Equals(a, "--app-version", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) {
                        InstallerOptions.AppVersion = args[++i];
                    } else if (string.Equals(a, "--old-pid", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) {
                        int.TryParse(args[++i], out oldPid);
                    } else if (string.Equals(a, "--replace", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) {
                        i++;
                    }
                }
            }

            // If replacing an older installer process, ensure the old process is terminated
            if (oldPid > 0) {
                try {
                    Process oldP = Process.GetProcessById(oldPid);
                    if (!oldP.WaitForExit(3000)) {
                        oldP.Kill();
                    }
                } catch { }
            }

            try {
                var app = new App { ShutdownMode = ShutdownMode.OnMainWindowClose };
                var win = new InstallerWindow();
                win.Closed += (s, e) => Environment.Exit(0);
                app.Run(win);
            } finally {
                Environment.Exit(0);
            }
        }
    }
}
