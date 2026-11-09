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
        private async void StartInstallWorkflow() {
            string targetDir = txtInstallPath.Text.Trim();
            if (string.IsNullOrEmpty(targetDir)) return;
            installTargetDir = targetDir;

            string err = PrecheckTarget(targetDir, currentLang == "en");
            if (err != null) {
                MessageBox.Show(err, "Target Check", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            cardConfig.Visibility = Visibility.Collapsed;
            cardProgress.Visibility = Visibility.Visible;
            btnCancel.Visibility = Visibility.Collapsed;
            btnAction.IsEnabled = false;

            txtProgressTitle.Text = (currentLang == "en") ? "Deploying Judge Research…" : "正在部署 司法院裁判研究…";
            txtProgressStatus.Text = (currentLang == "en") ? "Preparing target environment…" : "正在準備安裝環境…";

            // WPF 控制項只能在 UI 執行緒存取，因此在進入背景工作前先取出勾選狀態
            bool wantDesktop = chkDesktop.IsChecked == true;
            bool wantStartMenu = chkStartMenu.IsChecked == true;

            bool ok = false;
            string exMsg = null;
            await Task.Run(() => {
                try {
                    StopRunningApp();
                    InstallCore(targetDir, wantDesktop, wantStartMenu, (pct, status) => {
                        Dispatcher.Invoke(() => {
                            prgBar.Value = pct;
                            txtProgressPct.Text = pct + "%";
                            txtProgressStatus.Text = status;
                        });
                    });
                    ok = true;
                } catch (Exception ex) {
                    exMsg = ex.Message;
                }
            });

            if (!ok) {
                MessageBox.Show((currentLang == "en" ? "Installation failed: " : "安裝過程發生錯誤: ") + exMsg,
                    "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                cardProgress.Visibility = Visibility.Collapsed;
                cardConfig.Visibility = Visibility.Visible;
                btnCancel.Visibility = Visibility.Visible;
                btnAction.IsEnabled = true;
                return;
            }

            // 完成畫面
            installFinished = true;
            cardProgress.Visibility = Visibility.Collapsed;
            cardComplete.Visibility = Visibility.Visible;

            bool en = currentLang == "en";
            txtPageTitle.Text = en ? "Installation Complete" : "安裝順利完成";
            txtPageLead.Text = en
                ? "Judge Research is ready on your computer."
                : "司法院裁判研究 已成功部署就緒，可以開始檢索與整理判決。";

            txtCompleteTitle.Text = en ? "Ready to Research" : "應用程式已就緒";
            txtCompleteDesc.Text = en
                ? "Desktop shortcuts and judge-research:// protocols are registered.\nYou can now launch the app or open the installation folder."
                : "桌面捷徑已配置完畢。\n您現在可點擊下方按鈕直接啟動，開始搜尋與整理判決。";

            btnAction.Content = en ? "［ Launch Research Desk ］" : "［ 啟動應用程式 ］";
            btnAction.IsEnabled = true;

            btnCancel.Content = en ? "［ Open Folder ］" : "［ 開啟安裝目錄 ］";
            btnCancel.Visibility = Visibility.Visible;
        }

        // 注意：此方法在背景執行緒執行，不可存取任何 WPF 控制項（如 chkDesktop），只能使用參數傳入的值
        private void InstallCore(string targetDir, bool wantDesktop, bool wantStartMenu, Action<int, string> report) {
            bool en = currentLang == "en";
            report(10, en ? "Extracting application payload…" : "正在解壓縮應用程式核心組件…");
            Directory.CreateDirectory(targetDir);

            var asm = Assembly.GetExecutingAssembly();

            // 1. 解壓縮 app-payload.zip
            using (Stream zipStream = asm.GetManifestResourceStream("app-payload.zip")) {
                if (zipStream == null) {
                    throw new InvalidOperationException(en
                        ? "Installation payload is missing in this installer package."
                        : "安裝套件不完整：內部缺少應用程式核心組件，請下載完整發布版本。");
                }
                string zipTmp = Path.Combine(Path.GetTempPath(), "judge-payload-" + Guid.NewGuid().ToString("N") + ".zip");
                try {
                    using (FileStream fs = File.Create(zipTmp)) {
                        zipStream.CopyTo(fs);
                    }
                    report(35, en ? "Deploying files to disk…" : "正在將檔案寫入磁碟…");

                    using (ZipArchive archive = ZipFile.OpenRead(zipTmp)) {
                        int count = archive.Entries.Count;
                        int i = 0;
                        foreach (ZipArchiveEntry entry in archive.Entries) {
                            string fullDest = Path.Combine(targetDir, entry.FullName);
                            if (string.IsNullOrEmpty(entry.Name)) {
                                Directory.CreateDirectory(fullDest);
                            } else {
                                Directory.CreateDirectory(Path.GetDirectoryName(fullDest));
                                ExtractWithRetry(entry, fullDest, en);
                            }
                            i++;
                            if (i % 20 == 0) {
                                int pct = 35 + (int)(45.0 * i / count);
                                report(pct, string.Format(en ? "Extracting files ({0}/{1})…" : "正在解壓核心檔案 ({0}/{1})…", i, count));
                            }
                        }
                    }
                } finally {
                    try { File.Delete(zipTmp); } catch { }
                }
                TrimMemory();
            }

            report(82, en ? "Installing uninstaller and updater…" : "正在安裝專屬解除安裝與更新精靈…");

            // 2. 解放 uninstall.exe
            using (Stream uStream = asm.GetManifestResourceStream("uninstall.exe")) {
                if (uStream != null) {
                    string uPath = Path.Combine(targetDir, "uninstall.exe");
                    using (FileStream fs = File.Create(uPath)) {
                        uStream.CopyTo(fs);
                    }
                }
            }

            // 3. 解放 JudgeResearchUpdater.exe
            using (Stream upStream = asm.GetManifestResourceStream("JudgeResearchUpdater.exe")) {
                if (upStream != null) {
                    string upPath = Path.Combine(targetDir, "JudgeResearchUpdater.exe");
                    using (FileStream fs = File.Create(upPath)) {
                        upStream.CopyTo(fs);
                    }
                }
            }

            report(90, en ? "Configuring system shortcuts and protocols…" : "正在註冊系統捷徑與深度連結協定…");

            string exePath = GetMainExePath(targetDir);

            // 4. 捷徑建立
            if (wantDesktop) {
                try {
                    string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    CreateShortcut(Path.Combine(desktopDir, "司法院裁判研究.lnk"), exePath, targetDir, "司法院裁判研究");
                } catch { }
            }

            if (wantStartMenu) {
                try {
                    string startDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                    CreateShortcut(Path.Combine(startDir, "司法院裁判研究.lnk"), exePath, targetDir, "司法院裁判研究");
                } catch { }
            }

            // 5. 註冊通訊協定 judge-research://
            try {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\judge-research")) {
                    key.SetValue("", "URL:Judge Research Protocol");
                    key.SetValue("URL Protocol", "");
                    using (RegistryKey cmd = key.CreateSubKey(@"shell\open\command")) {
                        cmd.SetValue("", "\"" + exePath + "\" \"%1\"");
                    }
                }
            } catch { }

            // 6. 註冊 Windows 設定「已安裝應用程式」完整中繼資料
            report(96, en ? "Registering in Windows Settings…" : "正在寫入 Windows 設定之卸載資訊…");
            try {
                long totalBytes = 0;
                try {
                    DirectoryInfo di = new DirectoryInfo(targetDir);
                    foreach (FileInfo f in di.EnumerateFiles("*", SearchOption.AllDirectories)) {
                        totalBytes += f.Length;
                    }
                } catch { }
                int sizeKb = (int)(totalBytes / 1024);
                if (sizeKb <= 0) sizeKb = 150000;

                string uninstPath = Path.Combine(targetDir, "uninstall.exe");
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JudgeResearch")) {
                    key.SetValue("DisplayName", "司法院裁判研究");
                    key.SetValue("DisplayVersion", BuildInfo.Version);
                    key.SetValue("Publisher", "wasonisgood");
                    key.SetValue("InstallLocation", targetDir);
                    key.SetValue("UninstallString", "\"" + uninstPath + "\"");
                    key.SetValue("QuietUninstallString", "\"" + uninstPath + "\" --silent");
                    key.SetValue("DisplayIcon", exePath + ",0");
                    key.SetValue("EstimatedSize", sizeKb, RegistryValueKind.DWord);
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    key.SetValue("WindowsInstaller", 0, RegistryValueKind.DWord);
                    key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                    key.SetValue("HelpLink", "https://judge-remote-mcp-2026.web.app");
                    key.SetValue("URLInfoAbout", "https://judge-remote-mcp-2026.web.app");
                    key.SetValue("URLUpdateInfo", "https://github.com/wasonisgood/judge-desktop/releases");
                }
                UpdateCommon.NotifyShell();
            } catch { }

            report(100, en ? "Setup completed!" : "部署完成！");
        }

        // 檔案可能仍被剛結束的程序占用：短暫重試，仍被占用時給出明確說明（使用 C# 5 相容語法）。
    }
}
