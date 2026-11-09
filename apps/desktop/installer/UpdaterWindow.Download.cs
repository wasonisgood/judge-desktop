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
        private async Task DownloadAndLaunchAsync() {
            cancelRequested = false;
            state = UpState.Downloading; Render();
            UpdateState.Update(s => { s.Phase = "downloading"; });
            prgBar.Value = 0;
            txtProgressStatus.Text = T("連線中…", "Connecting…");
            txtProgressPct.Text = "0%";
            string dest = UpdateCommon.InstallerDownloadPath(manifest);

            try {
                await Task.Run(() => {
                    UpdateCommon.CleanupOldDownloads();
                    bool reuse = false;
                    if (File.Exists(dest)) {
                        try { UpdateCommon.VerifyInstaller(dest, manifest); reuse = !string.IsNullOrEmpty(manifest.Sha256); } catch { }
                    }
                    if (!reuse) {
                        // 依序嘗試來源（鏡像 → GitHub）；每個來源下載後都必須通過 SHA-256 校驗，失敗就換下一個。
                        Exception lastEx = null;
                        foreach (string src in manifest.InstallerUrls()) {
                            try {
                                UpdateCommon.DownloadFile(src, dest, manifest.Size, (done, total) => {
                                    Dispatcher.BeginInvoke(new Action(() => {
                                        int pct = total > 0 ? (int)(done * 100 / total) : 0;
                                        prgBar.Value = pct;
                                        txtProgressPct.Text = total > 0 ? pct + "%" : "";
                                        txtProgressStatus.Text = UpdateCommon.FormatSize(done) + (total > 0 ? " / " + UpdateCommon.FormatSize(total) : "");
                                    }));
                                }, () => cancelRequested);
                                UpdateCommon.VerifyInstaller(dest, manifest);
                                lastEx = null;
                                break;
                            } catch (OperationCanceledException) {
                                throw;
                            } catch (Exception ex) {
                                lastEx = ex;
                                UpdateCommon.Log("Installer from " + src + " failed: " + ex.Message);
                                try { File.Delete(dest); } catch { }
                            }
                        }
                        if (lastEx != null) throw lastEx;
                    }
                    Dispatcher.Invoke(() => { txtProgressStatus.Text = T("正在驗證檔案完整性…", "Verifying file integrity…"); });
                    UpdateState.Update(s => { s.Phase = "verifying"; });
                    UpdateCommon.VerifyInstaller(dest, manifest);
                });
            } catch (OperationCanceledException) {
                try { File.Delete(dest + ".part"); } catch { }
                state = UpState.Available; Render();
                return;
            } catch (Exception ex) {
                UpdateCommon.Log("Download failed: " + ex);
                try { File.Delete(dest); } catch { }
                errorDetail = ex is InvalidDataException
                    ? T("下載的檔案未通過完整性驗證（可能下載不完整或遭竄改）。", "Downloaded file failed verification.")
                    : ex.Message;
                state = UpState.DownloadError; Render();
                return;
            }

            try {
                Process.Start(new ProcessStartInfo {
                    FileName = dest,
                    Arguments = "--update-mode --no-self-update --lang " + lang,
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(dest)
                });
                var st = UpdateState.Load(); st.SnoozeUntilTicks = 0; st.Save();
                UpdateCommon.Log("Launched installer " + dest);
            } catch (Exception ex) {
                UpdateCommon.Log("Launch installer failed: " + ex);
                errorDetail = ex.Message;
                state = UpState.DownloadError; Render();
                return;
            }
            exitCode = UpdateCommon.ExitInstallerLaunched;
            state = UpState.Launching; Render();
            await Task.Delay(1200);
            Close();
        }

        private void SaveLang() {
            var st = UpdateState.Load(); st.Lang = lang; st.Save();
        }

    }
}
