using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Win32;
using JudgeResearch;
namespace JudgeResearchUpdater {
    public static class Program {
        [STAThread]
        public static int Main(string[] args) {
            bool manual = false;
            string appVersion = null, lang = null;
            for (int i = 0; i < args.Length; i++) {
                string a = args[i].ToLowerInvariant();
                if (a == "--manual") manual = true;
                else if (a == "--app-version" && i + 1 < args.Length) appVersion = args[++i];
                else if (a == "--lang" && i + 1 < args.Length) lang = args[++i];
            }
            if (string.IsNullOrEmpty(appVersion)) appVersion = ReadInstalledVersion() ?? UpdateCommon.CurrentBuildVersion;
            UpdateState state = UpdateState.Load();
            if (string.IsNullOrEmpty(lang)) lang = state.Lang ?? "zh";

            bool createdNew;
            using (Mutex mutex = new Mutex(true, @"Local\JudgeResearchUpdater", out createdNew)) {
                if (!createdNew) return UpdateCommon.ExitNoAction;

                UpdateManifest m = null;
                if (!manual) {
                    try { m = UpdateCommon.FetchManifest(8000); }
                    catch (Exception ex) { UpdateCommon.Log("Auto check failed: " + ex.Message); return UpdateCommon.ExitNoAction; }
                    if (!UpdateCommon.IsNewer(m.Version, appVersion)) {
                        return UpdateCommon.ExitNoAction;
                    }
                    bool forced = m.IsForcedFor(appVersion);
                    if (!forced && state.IsSnoozed) {
                        return UpdateCommon.ExitNoAction;
                    }
                }

                var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                app.DispatcherUnhandledException += (s, e) => { UpdateCommon.Log("Unhandled: " + e.Exception); e.Handled = true; };
                var win = new UpdaterWindow(manual, appVersion, m, lang);
                win.Closed += (s, e) => Environment.Exit(win.ExitCode);
                app.Run(win);
                Environment.Exit(win.ExitCode);
                return win.ExitCode;
            }
        }

        private static string ReadInstalledVersion() {
            try {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JudgeResearch")) {
                    return k != null ? k.GetValue("DisplayVersion") as string : null;
                }
            } catch { return null; }
        }
    }
}
