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
    public partial class InstallerWindow : Window {
        private string currentLang = "zh";

        [DllImport("psapi.dll")]
        private static extern int EmptyWorkingSet(IntPtr hwProc);

        public static void TrimMemory() {
            try {
                GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, true);
                GC.WaitForPendingFinalizers();
                GC.Collect();
                EmptyWorkingSet(Process.GetCurrentProcess().Handle);
            } catch { }
        }

        // 色彩配置（淺色底與單一強調色）
        private static readonly SolidColorBrush BrushPaper = new SolidColorBrush(Color.FromRgb(0xF1, 0xEC, 0xE2));
        private static readonly SolidColorBrush BrushPaperCard = new SolidColorBrush(Color.FromRgb(0xF7, 0xF3, 0xEA));
        private static readonly SolidColorBrush BrushDarkBar = new SolidColorBrush(Color.FromRgb(0x1A, 0x17, 0x14));
        private static readonly SolidColorBrush BrushInk = new SolidColorBrush(Color.FromRgb(0x23, 0x20, 0x1B));
        private static readonly SolidColorBrush BrushInkSoft = new SolidColorBrush(Color.FromRgb(0x5D, 0x55, 0x4A));
        private static readonly SolidColorBrush BrushInkFaint = new SolidColorBrush(Color.FromRgb(0x8D, 0x84, 0x75));
        private static readonly SolidColorBrush BrushHair = new SolidColorBrush(Color.FromRgb(0xCB, 0xBF, 0xA8));
        private static readonly SolidColorBrush BrushRule = new SolidColorBrush(Color.FromRgb(0x2A, 0x26, 0x20));
        private static readonly SolidColorBrush BrushShu = new SolidColorBrush(Color.FromRgb(0xB9, 0x47, 0x2B));
        private static readonly SolidColorBrush BrushShuHover = new SolidColorBrush(Color.FromRgb(0x9B, 0x33, 0x1A));

        // 字體
        private static readonly FontFamily FontMincho = new FontFamily("Shippori Mincho, Noto Serif TC, Yu Mincho, Hiragino Mincho ProN, MS Mincho, Georgia, serif");
        private static readonly FontFamily FontGothic = new FontFamily("Zen Kaku Gothic New, Microsoft JhengHei, Yu Gothic, Meiryo, sans-serif");
        private static readonly FontFamily FontRoman = new FontFamily("Cormorant Garamond, Times New Roman, serif");

        // UI 元件
        private TextBlock txtTitleBar;
        private Button btnToggleLang;
        private TextBlock txtKicker;
        private TextBlock txtPageTitle;
        private TextBlock txtPageLead;
        private TextBlock txtLblPath;
        private TextBox txtInstallPath;
        private Button btnBrowse;
        private CheckBox chkDesktop;
        private TextBlock txtLblDesktop;
        private CheckBox chkStartMenu;
        private TextBlock txtLblStartMenu;
        private TextBlock txtSizeBadge;
        private Button btnCancel;
        private Button btnAction;
        private TextBlock txtFootNote;

        // 進度步驟元件
        private Border cardConfig;
        private Border cardProgress;
        private Border cardComplete;
        private TextBlock txtProgressTitle;
        private ProgressBar prgBar;
        private TextBlock txtProgressStatus;
        private TextBlock txtProgressPct;
        private TextBlock txtCompleteTitle;
        private TextBlock txtCompleteDesc;

        private Button btnMaximize;
        private bool isMaximized = false;
        private Rect normalBounds;

        // 已安裝偵測 / 修復模式
        private bool isRepairMode = false;
        private bool installFinished = false;
        private string installTargetDir = "";
        private string existingInstallDir = null;
        private string installedVersion = null;
        private bool isUpgrade = false;

        // 安裝程式自我更新
        private bool selfUpdating = false;
        private volatile bool selfUpdateCancel = false;
        private UpdateManifest selfUpdateManifest = null;

        public InstallerWindow() {
            if (InstallerOptions.Lang == "en" || InstallerOptions.Lang == "zh") currentLang = InstallerOptions.Lang;
            Title = "司法院裁判研究 ・ 安裝指南";
            Width = 820;
            Height = 570;
            MinWidth = 700;
            MinHeight = 490;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            Background = BrushPaper;
            Foreground = BrushInk;
            FontFamily = FontMincho;

            try {
                Stream iconStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico");
                if (iconStream != null) {
                    Icon = System.Windows.Media.Imaging.BitmapFrame.Create(iconStream);
                }
            } catch { }

            WindowChrome.SetWindowChrome(this, new WindowChrome {
                CaptionHeight = 0,
                ResizeBorderThickness = new Thickness(6),
                GlassFrameThickness = new Thickness(0),
                CornerRadius = new CornerRadius(0),
                UseAeroCaptionButtons = false
            });

            BuildUI();
            DetectExistingInstall();
            UpdateLanguage();
            Loaded += OnStartup;
            Closed += (s, e) => {
                try { TrimMemory(); } catch { }
                Environment.Exit(0);
            };
        }

        private void OnStartup(object sender, RoutedEventArgs e) {
            if (InstallerOptions.UpdateMode && existingInstallDir != null) {
                string desk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "司法院裁判研究.lnk");
                string start = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "司法院裁判研究.lnk");
                chkDesktop.IsChecked = File.Exists(desk);
                chkStartMenu.IsChecked = File.Exists(start);
                StartInstallWorkflow();
                return;
            }
            if (!InstallerOptions.NoSelfUpdate) CheckForNewerInstaller();
        }

        private async void CheckForNewerInstaller() {
            bool en = currentLang == "en";
            btnAction.IsEnabled = false;
            txtFootNote.Text = en ? "Checking for newer installer releases online…" : "正在檢查線上是否有更新版本的安裝程式…";
            UpdateManifest m = null;
            try {
                m = await Task.Run(() => UpdateCommon.FetchManifest(6000));
            } catch (Exception ex) {
                UpdateCommon.Log("Self-update check failed: " + ex.Message);
            }
            if (installFinished || cardConfig.Visibility != Visibility.Visible) return;
            en = currentLang == "en";

            if (m == null || !UpdateCommon.IsNewer(m.Version, BuildInfo.Version)) {
                btnAction.IsEnabled = true;
                txtFootNote.Text = m == null
                    ? (en ? "Cannot reach update server. Proceeding with v" + BuildInfo.Version : "無法連線更新伺服器，將以目前版本 v" + BuildInfo.Version + " 安裝。")
                    : (en ? "Latest installer version (v" + BuildInfo.Version + ")" : "已是最新版安裝程式（v" + BuildInfo.Version + "）");
                return;
            }

            UpdateCommon.Log("Newer installer found: " + m.Version + " (self " + BuildInfo.Version + ")");
            selfUpdateManifest = m;
            await DownloadAndRelaunchNewerInstaller();
        }

        private void ApplySelfUpdateTexts() {
            if (!selfUpdating || selfUpdateManifest == null) return;
            bool en = currentLang == "en";
            string v = "v" + UpdateCommon.ParseVersion(selfUpdateManifest.Version).ToString(3);
            txtKicker.Text = en ? "JUDGE RESEARCH · INSTALLER UPDATE" : "司法院裁判研究 · 安裝程式更新";
            txtPageTitle.Text = en ? "Newer Installer Available" : "發現新版安裝引導程式";
            txtPageLead.Text = en
                ? "A newer installer version (" + v + ") is available. Downloading and replacing automatically."
                : "線上已有更高版本（" + v + "）的安裝程式，正在自動下載並切換至新版引導程序。";
            txtProgressTitle.Text = en ? "Fetching installer " + v + "…" : "正在取得新版安裝引導程式 " + v + "…";
            btnCancel.Content = en ? "［ Skip, Use Current ］" : "［ 略過，使用目前版本 ］";
        }

        private async Task DownloadAndRelaunchNewerInstaller() {
            UpdateManifest m = selfUpdateManifest;
            selfUpdating = true;
            selfUpdateCancel = false;
            cardConfig.Visibility = Visibility.Collapsed;
            cardProgress.Visibility = Visibility.Visible;
            btnAction.Visibility = Visibility.Collapsed;
            btnCancel.Visibility = m.IsForcedFor(BuildInfo.Version) ? Visibility.Collapsed : Visibility.Visible;
            prgBar.Value = 0;
            txtProgressPct.Text = "0%";
            txtProgressStatus.Text = (currentLang == "en") ? "Connecting…" : "連線中…";
            ApplySelfUpdateTexts();

            string dest = UpdateCommon.InstallerDownloadPath(m);
            string error = null;
            try {
                await Task.Run(() => {
                    UpdateCommon.CleanupOldDownloads();
                    UpdateCommon.DownloadFile(m.InstallerUrl, dest, m.Size, (done, total) => {
                        Dispatcher.BeginInvoke(new Action(() => {
                            int pct = total > 0 ? (int)(done * 100 / total) : 0;
                            prgBar.Value = pct;
                            txtProgressPct.Text = total > 0 ? pct + "%" : "";
                            txtProgressStatus.Text = UpdateCommon.FormatSize(done) + (total > 0 ? " / " + UpdateCommon.FormatSize(total) : "");
                        }));
                    }, () => selfUpdateCancel);
                    UpdateCommon.VerifyInstaller(dest, m);
                });
            } catch (OperationCanceledException) {
                try { File.Delete(dest + ".part"); } catch { }
                EndSelfUpdate(null);
                return;
            } catch (Exception ex) {
                try { File.Delete(dest); } catch { }
                error = ex.Message;
            }

            if (error == null) {
                try {
                    string self = Assembly.GetExecutingAssembly().Location;
                    string args = "--no-self-update --lang " + currentLang +
                                  " --old-pid " + Process.GetCurrentProcess().Id +
                                  " --replace " + UpdateCommon.Quote(self);
                    Process.Start(new ProcessStartInfo { FileName = dest, Arguments = args, UseShellExecute = true });
                    installFinished = true;
                    Application.Current.Shutdown();
                    Environment.Exit(0);
                    return;
                } catch (Exception ex) {
                    error = ex.Message;
                }
            }
            EndSelfUpdate(error);
        }

        private void EndSelfUpdate(string error) {
            selfUpdating = false;
            bool forcedSelf = selfUpdateManifest != null && selfUpdateManifest.IsForcedFor(BuildInfo.Version);
            cardProgress.Visibility = Visibility.Collapsed;
            cardConfig.Visibility = Visibility.Visible;
            btnAction.Visibility = Visibility.Visible;
            btnCancel.Visibility = Visibility.Visible;
            UpdateLanguage();
            txtKicker.Text = currentLang == "en" ? (isRepairMode ? "JUDGE RESEARCH · REPAIR" : "JUDGE RESEARCH · INSTALL") : (isRepairMode ? "司法院裁判研究 · 修復" : "司法院裁判研究 · 安裝");
            bool en = currentLang == "en";
            if (error != null) {
                MessageBox.Show((en ? "Failed to download newer installer: " : "新版安裝引導程式下載失敗：") + error +
                    "\n\n" + (forcedSelf
                        ? (en ? "This update is required. Please check your network and retry." : "此版本為強制更新，請確認網路後重新執行。")
                        : (en ? "You may proceed with current v" + BuildInfo.Version : "您仍可使用目前版本 v" + BuildInfo.Version + " 繼續安裝。")),
                    "Installer Update", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            if (forcedSelf && error != null) {
                btnAction.IsEnabled = false;
                txtFootNote.Text = en ? "Required installer update failed." : "無法取得強制更新版安裝程式，請稍後再試。";
            }
        }

    }
}
