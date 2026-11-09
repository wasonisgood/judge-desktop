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
    public partial class UpdaterWindow {
        private void Render() {
            Title = T("司法院裁判研究 — 更新案內", "Judge Research — Update Guide");
            txtTitleBar.Text = Title.Replace(" — ", " ・ ");
            btnToggleLang.Content = lang == "en" ? "切換繁體中文" : "English";
            txtKicker.Text = "MOOT COURT COMPANION DESK / UPDATE SUITE";

            cardInfo.Visibility = state == UpState.Available ? Visibility.Visible : Visibility.Collapsed;
            cardProgress.Visibility = state == UpState.Downloading || state == UpState.Checking ? Visibility.Visible : Visibility.Collapsed;
            cardMessage.Visibility = (state == UpState.UpToDate || state == UpState.CheckError || state == UpState.DownloadError || state == UpState.Launching) ? Visibility.Visible : Visibility.Collapsed;
            btnSecondary.Visibility = Visibility.Visible;
            btnPrimary.Visibility = Visibility.Visible;
            btnPrimary.IsEnabled = true;
            btnClose.IsEnabled = true;
            txtFootNote.Text = "© DEBATE COMPANION DESK / judge-remote-mcp-2026.web.app";

            string latest = manifest != null ? "v" + UpdateCommon.ParseVersion(manifest.Version).ToString(3) : "";
            string current = "v" + UpdateCommon.ParseVersion(currentVersion).ToString(3);

            switch (state) {
                case UpState.Checking:
                    txtPageTitle.Text = T("正在檢查更新", "Checking for Updates");
                    txtPageLead.Text = T("正在向更新伺服器查詢是否有新版本的司法院裁判研究…", "Querying update server for latest judge companion releases…");
                    txtProgressTitle.Text = T("連線至更新伺服器…", "Connecting to update server…");
                    prgBar.IsIndeterminate = true;
                    txtProgressStatus.Text = T("目前版本 ", "Current Version ") + current;
                    txtProgressPct.Text = "";
                    btnSecondary.Visibility = Visibility.Collapsed;
                    btnPrimary.Content = T("［ 關閉 ］", "［ Close ］");
                    btnPrimary.IsEnabled = false;
                    break;

                case UpState.UpToDate:
                    txtPageTitle.Text = T("已是最新版本", "Latest Version Installed");
                    txtPageLead.Text = T("您目前使用的司法院裁判研究已是最新版本，無須更新。", "Your research desk application is up to date.");
                    txtSealMsg.Text = "新";
                    txtMsgTitle.Text = T("目前版本 ", "Current Version ") + current;
                    txtMsgDesc.Text = T("程式會在每次啟動時自動檢查最新發行版本。", "research desk automatically checks for newer releases upon launch.");
                    btnSecondary.Visibility = Visibility.Collapsed;
                    btnPrimary.Content = T("［ 關閉 ］", "［ Close ］");
                    break;

                case UpState.CheckError:
                    txtPageTitle.Text = T("無法檢查更新", "Unable to Check Updates");
                    txtPageLead.Text = T("暫時無法連線至更新伺服器，請確認網路連線後再試一次。", "Cannot reach update server. Please check your network and retry.");
                    txtSealMsg.Text = "斷";
                    txtMsgTitle.Text = T("連線失敗", "Connection Error");
                    txtMsgDesc.Text = (errorDetail ?? "") + "\n" + T("詳細記錄：", "Log: ") + UpdateCommon.LogPath;
                    btnSecondary.Content = T("［ 關閉 ］", "［ Close ］");
                    btnPrimary.Content = T("［ 重試 ］", "［ Retry ］");
                    break;

                case UpState.Available:
                    txtKicker.Text = forced ? "MOOT COURT COMPANION DESK / MANDATORY UPDATE" : "MOOT COURT COMPANION DESK / UPDATE SUITE";
                    txtPageTitle.Text = forced ? T("必須更新至新版本", "Mandatory Update Required") : T("發現新版本", "New Update Available");
                    txtPageLead.Text = forced
                        ? T("此版本已停止支援，請更新後再繼續使用。", "This version is deprecated. Please install update to continue moot court drills.")
                        : T("有新版本可供更新，是否現在下載並安裝？設定、AI 金鑰與本機快取皆會保留。", "A newer release is available. Would you like to install now? All judge records and notes will be preserved.");
                    lblCurrent.Text = T("目前版本", "Current");
                    valCurrent.Text = current;
                    lblLatest.Text = T("最新版本", "Latest");
                    valLatest.Text = latest;
                    string meta = "";
                    if (!string.IsNullOrEmpty(manifest.ReleaseDate)) meta += T("發布日 ", "Release Date ") + manifest.ReleaseDate;
                    if (manifest.Size > 0) meta += (meta.Length > 0 ? "　｜　" : "") + T("下載大小 約 ", "Download Size ~") + UpdateCommon.FormatSize(manifest.Size);
                    txtMeta.Text = meta;
                    txtMeta.Visibility = meta.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
                    lblNotes.Text = T("更新內容", "Release Notes");
                    string notes = manifest.Notes(lang);
                    txtNotes.Text = string.IsNullOrEmpty(notes) ? T("（本次更新未附說明）", "(No release notes provided)") : notes;
                    forcedBanner.Visibility = forced ? Visibility.Visible : Visibility.Collapsed;
                    txtForced.Text = T("【強制更新】此為重要修正更新，請更新後再繼續使用。", "【Mandatory Update】This release contains critical fixes and is required to continue.");
                    chkSnooze.Visibility = forced ? Visibility.Collapsed : Visibility.Visible;
                    txtSnooze.Text = T("暫不提醒此版本（7 天內不再提示）", "Snooze reminder for 7 days");
                    btnSecondary.Content = forced ? T("［ 結束程式 ］", "［ Exit App ］") : T("［ 稍後再說 ］", "［ Later ］");
                    btnPrimary.Content = T("［ 立即下載並更新 ］", "［ Update Now ］");
                    txtFootNote.Text = forced ? "" : T("不勾選時，下次開啟程式仍會提醒。", "If unchecked, you will be notified on next launch.");
                    break;

                case UpState.Downloading:
                    txtPageTitle.Text = T("正在下載新版本", "Downloading Update");
                    txtPageLead.Text = T("下載完成後將自動啟動安裝引導程式，並於更新後重新啟動應用程式。", "After download, the installer will launch automatically and restart companion desk.");
                    txtProgressTitle.Text = T("正在下載 ", "Downloading ") + latest + T(" 安裝程式…", " Installer…");
                    prgBar.IsIndeterminate = false;
                    btnSecondary.Visibility = Visibility.Collapsed;
                    btnPrimary.Content = T("［ 取消下載 ］", "［ Cancel Download ］");
                    btnClose.IsEnabled = false;
                    break;

                case UpState.DownloadError:
                    txtPageTitle.Text = T("更新未完成", "Update Incomplete");
                    txtPageLead.Text = T("下載或驗證新版本時發生問題，目前的程式不受影響。", "Download failed. Your current companion desk is unaffected.");
                    txtSealMsg.Text = "誤";
                    txtMsgTitle.Text = T("下載失敗", "Download Failed");
                    txtMsgDesc.Text = (errorDetail ?? "") + "\n" + T("詳細記錄：", "Log: ") + UpdateCommon.LogPath;
                    btnSecondary.Content = forced ? T("［ 結束程式 ］", "［ Exit ］") : T("［ 稍後再說 ］", "［ Later ］");
                    btnPrimary.Content = T("［ 重試 ］", "［ Retry ］");
                    break;

                case UpState.Launching:
                    txtPageTitle.Text = T("準備安裝", "Launching Installer");
                    txtPageLead.Text = T("新版安裝引導程式已啟動，程式將於更新完成後自動重新開啟。", "New installer launched. research desk will restart upon completion.");
                    txtSealMsg.Text = "完";
                    txtMsgTitle.Text = T("下載完成 ", "Downloaded ") + latest;
                    txtMsgDesc.Text = T("正在交由安裝引導程式完成無縫升級…", "Handing over to installer for seamless upgrade…");
                    btnSecondary.Visibility = Visibility.Collapsed;
                    btnPrimary.Visibility = Visibility.Collapsed;
                    break;
            }
        }

        private async void OnPrimary() {
            switch (state) {
                case UpState.UpToDate: Close(); break;
                case UpState.CheckError: await CheckAsync(); break;
                case UpState.Available:
                case UpState.DownloadError: await DownloadAndLaunchAsync(); break;
                case UpState.Downloading: cancelRequested = true; break;
            }
        }

        private void OnSecondary() { Close(); }

        private void OnClosingWindow(System.ComponentModel.CancelEventArgs e) {
            if (state == UpState.Downloading) { e.Cancel = true; return; }
            if (state == UpState.Launching) return;
            if (manifest != null && (state == UpState.Available || state == UpState.DownloadError)) {
                if (forced) {
                    exitCode = UpdateCommon.ExitForcedDeclined;
                } else {
                    var st = UpdateState.Load();
                    st.SnoozeUntilTicks = chkSnooze.IsChecked == true ? DateTime.UtcNow.AddDays(7).Ticks : 0;
                    st.Save();
                }
            }
        }

    }
}
