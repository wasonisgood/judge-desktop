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
    public partial class UninstallerWindow {
        private void UpdateLanguage() {
            bool en = currentLang == "en";
            Title = en ? "Judge Research — Uninstallation Setup" : "司法院裁判研究 — 解除安裝指南";
            btnToggleLang.Content = en ? "切換繁體中文" : "English";
            txtTitleBar.Text = en ? "Judge Research ・ Uninstall" : "司法院裁判研究 ・ 解除安裝";
            txtPageTitle.Text = en ? "Uninstall ・ Keep the App" : "解除安裝 ・ 保留程式";
            txtPageLead.Text = en
                ? "Every oral argument and question intervention is a journey of growth. If the companion lacks anything, please share your thoughts; we always welcome your return."
                : "若程式有不便或不足之處，歡迎告訴我們，我們會持續改進。之後需要時，隨時可以再安裝。";
            txtRetainTitle.Text = en ? "【Keep Suggestion】Keep the app for future research?" : "【保留建議】是否要保留程式？";
            txtRetainDesc.Text = en
                ? "Judge Research takes only ~180 MB. Keeping it on your computer lets you practice 40-minute moot court simulations and verify case law anytime."
                : "本程式僅佔約 150 MB 空間。日常保留於電腦中，日後若需要檢索或整理判決，隨時點擊即可秒開練習。";
            btnRetainApp.Content = en ? "［ Keep App ］" : "［ 保留程式 ］";
            btnResetCacheOnly.Content = en ? "［ Clear Cache Only ］" : "［ 僅清除本機快取 ］";
            txtSurveyLabel.Text = en
                ? "Please tell us why you are uninstalling (Multiple selection allowed):"
                : "請告訴我們您選擇離別的主要原因（可多選，助我們精進改進）：";
            txtReason1.Text = en ? "The current research project has concluded" : "本次研究與整理工作已告一段落";
            txtReason2.Text = en ? "Switched to an online version or another tool" : "改用線上版本或其他工具";
            txtReason3.Text = en ? "Encountered speech recognition, TTS or connection difficulties" : "遇到提問中斷、語音朗讀或技術連線問題";
            txtReason4.Text = en ? "Clearing disk space or migrating computer environments" : "整理電腦硬碟儲存空間或更換電腦設備";
            txtFeedback.ToolTip = en ? "Optional feedback or suggestions…" : "若有其他建議，歡迎在此留言...";
            btnCancel.Content = en ? "［ I'll think about it, Keep ］" : "［ 我再想想，保留程式 ］";
            btnConfirmUninstall.Content = en ? "［ Confirm Uninstall ］" : "［ 忍痛徹底解除安裝 ］";
            txtProgressTitle.Text = en ? "Removing app files and registrations…" : "正在移除程式登錄與安裝檔案...";
            txtFarewellTitle.Text = en ? "Uninstallation Succeeded" : "程式已順利解除安裝";
            txtFarewellDesc.Text = en
                ? "Judge Research has been completely removed from your computer.\nThank you for using the app."
                : "「司法院裁判研究」已從您的電腦中完整解除安裝。\n感謝您使用本程式。";
            btnFarewellClose.Content = en ? "［ Close ］" : "［ 關閉 ］";
        }

        private async void StartUninstallWorkflow() {
            cardSurvey.Visibility = Visibility.Collapsed;
            cardProgress.Visibility = Visibility.Visible;
            btnCancel.Visibility = Visibility.Collapsed;
            btnConfirmUninstall.IsEnabled = false;

            await Task.Run(() => PerformUninstallation());

            cardProgress.Visibility = Visibility.Collapsed;
            cardFarewell.Visibility = Visibility.Visible;

            txtPageTitle.Text = (currentLang == "en") ? "Uninstallation Complete" : "解除安裝完畢";
            txtPageLead.Text = (currentLang == "en")
                ? "All registrations and core resources have been completely erased."
                : "所有登錄檔資訊與程式檔案已完全移除。";
        }

        private void UpdateProgress(int pct, string status) {
            Dispatcher.Invoke(() => {
                prgBar.Value = pct;
                txtProgressPct.Text = pct + "%";
                txtProgressStatus.Text = status;
            });
        }

        private void PerformUninstallation() {
            bool en = currentLang == "en";
            UpdateProgress(15, en ? "Stopping running app processes…" : "正在結束執行中的程式...");
            Thread.Sleep(300);

            // 1. 關閉執行中行程
            string[] procNames = { "JudgeResearch", "JudgeResearchUpdater", "司法院裁判研究" };
            foreach (string pName in procNames) {
                foreach (Process p in Process.GetProcessesByName(pName)) {
                    try {
                        p.Kill();
                        p.WaitForExit(1500);
                    } catch { }
                }
            }

            // 2. 登錄檔抹除
            UpdateProgress(40, en ? "Removing Windows uninstall registration…" : "正在從 Windows 應用程式清單撤銷登記...");
            Thread.Sleep(300);
            try {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JudgeResearch", false);
            } catch { }
            try {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\judge-research", false);
            } catch { }

            // 3. 捷徑抹除
            UpdateProgress(65, en ? "Deleting desktop and menu shortcuts…" : "正在移除桌面與開始功能表的捷徑...");
            Thread.Sleep(300);
            try {
                string deskPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "司法院裁判研究.lnk");
                if (File.Exists(deskPath)) File.Delete(deskPath);
                string deskOld = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "司法院裁判研究.lnk");
                if (File.Exists(deskOld)) File.Delete(deskOld);
            } catch { }

            try {
                string progDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                string lnk = Path.Combine(progDir, "司法院裁判研究.lnk");
                if (File.Exists(lnk)) File.Delete(lnk);
                string lnkOld = Path.Combine(progDir, "司法院裁判研究.lnk");
                if (File.Exists(lnkOld)) File.Delete(lnkOld);
            } catch { }

            // 4. 通知 Windows Shell 即刻刷新
            UpdateCommon.NotifyShell();

            // 5. 檔案系統刪除與殘留自毀批次
            UpdateProgress(90, en ? "Preparing target folder self-clean script…" : "正在排程抹除主程式與暫存目錄...");
            Thread.Sleep(300);

            string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string batPath = Path.Combine(Path.GetTempPath(), "judge_uninstall_wipe_" + Guid.NewGuid().ToString("N") + ".bat");

            string batContent = string.Format(
                "@echo off\r\n" +
                ":retry\r\n" +
                "timeout /t 1 /nobreak >nul\r\n" +
                "rmdir /s /q \"{0}\" >nul 2>&1\r\n" +
                "if exist \"{0}\" goto retry\r\n" +
                "del \"%~f0\" >nul 2>&1\r\n", appDir);

            try {
                File.WriteAllText(batPath, batContent, Encoding.Default);
                ProcessStartInfo psi = new ProcessStartInfo {
                    FileName = batPath,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    UseShellExecute = true
                };
                Process.Start(psi);
            } catch (Exception ex) {
                UpdateCommon.Log("Wipe bat spawn failed: " + ex);
            }

            UpdateProgress(100, en ? "Uninstallation completed!" : "已順利完成解除安裝。");
            Thread.Sleep(200);
        }

        private void FinalizeSelfDeleteAndClose() {
            Close();
        }
    }
}
