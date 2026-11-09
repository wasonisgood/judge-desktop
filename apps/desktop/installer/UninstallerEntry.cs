using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Win32;
using JudgeResearch;

namespace JudgeResearchUninstaller {
    public class App : Application {
        [STAThread]
        public static void Main(string[] args) {
            bool silent = false;
            if (args != null) {
                foreach (string a in args) {
                    if (string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "/quiet", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase)) {
                        silent = true;
                        break;
                    }
                }
            }

            if (silent) {
                // 靜默模式直接執行
                SilentUninstall();
                return;
            }

            var app = new App { ShutdownMode = ShutdownMode.OnMainWindowClose };
            var win = new UninstallerWindow();
            win.Closed += (s, e) => Environment.Exit(0);
            app.Run(win);
            Environment.Exit(0);
        }

        private static void SilentUninstall() {
            string[] procNames = { "JudgeResearch", "JudgeResearchUpdater", "司法院裁判研究" };
            foreach (string pName in procNames) {
                foreach (Process p in Process.GetProcessesByName(pName)) {
                    try { p.Kill(); p.WaitForExit(1500); } catch { }
                }
            }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JudgeResearch", false); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\judge-research", false); } catch { }

            try {
                string deskPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "司法院裁判研究.lnk");
                if (File.Exists(deskPath)) File.Delete(deskPath);
                string startPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "司法院裁判研究.lnk");
                if (File.Exists(startPath)) File.Delete(startPath);
            } catch { }

            UpdateCommon.NotifyShell();

            string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string batPath = Path.Combine(Path.GetTempPath(), "judge_uninstall_wipe_" + Guid.NewGuid().ToString("N") + ".bat");
            string batContent = string.Format(
                "@echo off\r\n:retry\r\ntimeout /t 1 /nobreak >nul\r\nrmdir /s /q \"{0}\" >nul 2>&1\r\nif exist \"{0}\" goto retry\r\ndel \"%~f0\" >nul 2>&1\r\n", appDir);
            try {
                File.WriteAllText(batPath, batContent, Encoding.Default);
                Process.Start(new ProcessStartInfo { FileName = batPath, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = true });
            } catch { }
        }
    }
}
