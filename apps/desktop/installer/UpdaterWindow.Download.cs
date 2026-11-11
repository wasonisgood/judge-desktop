using System;
using System.Collections.Generic;
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
        // 下載與啟動：
        //  1. 只更新 App（不強制、安裝程式版本相同、快取可用）→ 只下載 payload zip，交由快取的安裝程式套用。
        //  2. 其餘情況（強制版、安裝程式版本改變、快取不存在或失效）→ 下載完整安裝程式，並快取起來。
        //  payload 路徑若失敗，自動改走完整安裝程式，不會讓使用者卡住。
        private async Task DownloadAndLaunchAsync() {
            cancelRequested = false;
            state = UpState.Downloading; Render();
            UpdateState.Update(s => { s.Phase = "downloading"; });
            prgBar.Value = 0;
            txtProgressStatus.Text = T("連線中…", "Connecting…");
            txtProgressPct.Text = "0%";

            if (UpdateCommon.CanUsePayloadUpdate(manifest, forced)) {
                int r = await TryPayloadUpdateAsync();
                if (r == 1) return;                                              // 已啟動安裝，視窗即將關閉
                if (r == 2) { state = UpState.Available; Render(); return; }     // 使用者取消
                prgBar.Value = 0;
                txtProgressStatus.Text = T("改為下載完整安裝程式…", "Falling back to the full installer…");
                txtProgressPct.Text = "0%";
            }
            await DownloadFullInstallerAsync();
        }

        /// <summary>回傳 1 = 已啟動安裝；2 = 已取消；0 = 失敗，應改走完整安裝程式。</summary>
        private async Task<int> TryPayloadUpdateAsync() {
            string cached = UpdateCommon.UsableCachedInstaller(manifest.InstallerVersion);
            if (cached == null) return 0;
            string zip = UpdateCommon.PayloadDownloadPath(manifest);
            try {
                await Task.Run(() => {
                    UpdateCommon.CleanupOldDownloads();
                    bool reuse = false;
                    if (File.Exists(zip)) {
                        try { UpdateCommon.VerifyFile(zip, manifest.PayloadSha256, manifest.PayloadSize); reuse = true; } catch { }
                    }
                    if (!reuse) {
                        DownloadFromSources(manifest.PayloadUrls(), zip, manifest.PayloadSize,
                            p => UpdateCommon.VerifyFile(p, manifest.PayloadSha256, manifest.PayloadSize));
                    }
                    UpdateState.Update(s => { s.Phase = "verifying"; });
                });
            } catch (OperationCanceledException) {
                try { File.Delete(zip + ".part"); } catch { }
                return 2;
            } catch (Exception ex) {
                UpdateCommon.Log("Payload update failed, falling back to full installer: " + ex.Message);
                try { File.Delete(zip); } catch { }
                return 0;
            }
            // 由快取的安裝程式套用 payload；版本號以清單為準。
            string args = "--update-mode --no-self-update --lang " + lang
                + " --app-version " + manifest.Version + " --payload \"" + zip + "\"";
            if (!StartInstaller(cached, args)) return 0;
            await FinishLaunchAsync();
            return 1;
        }

        private async Task DownloadFullInstallerAsync() {
            string dest = UpdateCommon.InstallerDownloadPath(manifest);
            try {
                await Task.Run(() => {
                    UpdateCommon.CleanupOldDownloads();
                    bool reuse = false;
                    if (File.Exists(dest)) {
                        try { UpdateCommon.VerifyInstaller(dest, manifest); reuse = !string.IsNullOrEmpty(manifest.Sha256); } catch { }
                    }
                    if (!reuse) {
                        DownloadFromSources(manifest.InstallerUrls(), dest, manifest.Size, p => UpdateCommon.VerifyInstaller(p, manifest));
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

            // 完整安裝程式已通過校驗：快取起來，之後同一安裝程式版本的 App 更新不必再重下。
            UpdateCommon.SaveInstallerCache(dest, manifest.InstallerVersion);
            if (!StartInstaller(dest, "--update-mode --no-self-update --lang " + lang)) {
                state = UpState.DownloadError; Render();
                return;
            }
            await FinishLaunchAsync();
        }

        // 依序嘗試來源（鏡像 → GitHub）；每個來源下載後都必須通過 verify，失敗就換下一個。取消時拋出 OperationCanceledException。
        private void DownloadFromSources(List<string> urls, string dest, long size, Action<string> verify) {
            Exception lastEx = null;
            foreach (string src in urls) {
                try {
                    UpdateCommon.DownloadFile(src, dest, size, ProgressCallback(), () => cancelRequested);
                    verify(dest);
                    lastEx = null;
                    break;
                } catch (OperationCanceledException) {
                    throw;
                } catch (Exception ex) {
                    lastEx = ex;
                    UpdateCommon.Log("Download from " + src + " failed: " + ex.Message);
                    try { File.Delete(dest); } catch { }
                }
            }
            if (lastEx != null) throw lastEx;
        }

        private Action<long, long> ProgressCallback() {
            return (done, total) => {
                Dispatcher.BeginInvoke(new Action(() => {
                    int pct = total > 0 ? (int)(done * 100 / total) : 0;
                    prgBar.Value = pct;
                    txtProgressPct.Text = total > 0 ? pct + "%" : "";
                    txtProgressStatus.Text = UpdateCommon.FormatSize(done) + (total > 0 ? " / " + UpdateCommon.FormatSize(total) : "");
                }));
            };
        }

        private bool StartInstaller(string exe, string args) {
            try {
                Process.Start(new ProcessStartInfo {
                    FileName = exe,
                    Arguments = args,
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(exe)
                });
                var st = UpdateState.Load(); st.SnoozeUntilTicks = 0; st.Save();
                UpdateCommon.Log("Launched installer " + exe + " (" + args + ")");
                return true;
            } catch (Exception ex) {
                UpdateCommon.Log("Launch installer failed: " + ex);
                errorDetail = ex.Message;
                return false;
            }
        }

        private async Task FinishLaunchAsync() {
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
