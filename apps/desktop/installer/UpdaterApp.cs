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

// 司法院裁判研究 ・ 更新程式（JudgeResearchUpdater.exe）
//   由主程式於啟動時呼叫：JudgeResearchUpdater.exe --app-version 1.0.2
//   手動檢查：JudgeResearchUpdater.exe --manual
// 結束代碼：0 = 無動作／稍後提醒，10 = 已啟動新版安裝程式，20 = 強制更新被拒
namespace JudgeResearchUpdater {
    public enum UpState { Checking, UpToDate, CheckError, Available, Downloading, DownloadError, Launching }

    public partial class UpdaterWindow : Window {
        private string lang = "zh";
        private readonly bool manual;
        private readonly string currentVersion;
        private UpdateManifest manifest;
        private bool forced;
        private UpState state;
        private string errorDetail;
        private volatile bool cancelRequested;
        private int exitCode = UpdateCommon.ExitNoAction;

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
        private static readonly SolidColorBrush BrushShuWash = new SolidColorBrush(Color.FromRgb(0xF4, 0xE4, 0xDC));

        private static readonly FontFamily FontMincho = new FontFamily("Shippori Mincho, Noto Serif TC, Yu Mincho, Hiragino Mincho ProN, MS Mincho, Georgia, serif");
        private static readonly FontFamily FontGothic = new FontFamily("Zen Kaku Gothic New, Microsoft JhengHei, Yu Gothic, Meiryo, sans-serif");
        private static readonly FontFamily FontRoman = new FontFamily("Cormorant Garamond, Times New Roman, serif");

        private TextBlock txtTitleBar, txtKicker, txtPageTitle, txtPageLead, txtFootNote;
        private Button btnToggleLang, btnClose, btnSecondary, btnPrimary;
        private Border cardInfo, cardProgress, cardMessage, forcedBanner;
        private TextBlock lblCurrent, valCurrent, lblLatest, valLatest, txtMeta, lblNotes, txtNotes, txtForced;
        private CheckBox chkSnooze;
        private TextBlock txtSnooze;
        private TextBlock txtProgressTitle, txtProgressStatus, txtProgressPct;
        private ProgressBar prgBar;
        private TextBlock txtSealMsg, txtMsgTitle, txtMsgDesc;
        private Border sealMsg;

        public UpdaterWindow(bool manual, string currentVersion, UpdateManifest preloaded, string lang) {
            this.manual = manual;
            this.currentVersion = currentVersion;
            this.lang = lang == "en" ? "en" : "zh";

            Title = "司法院裁判研究 ・ 更新案內";
            Width = 720;
            Height = 540;
            MinWidth = 620;
            MinHeight = 480;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            Background = BrushPaper;
            Foreground = BrushInk;
            FontFamily = FontMincho;
            Topmost = true;

            try {
                Stream iconStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico");
                if (iconStream != null) Icon = System.Windows.Media.Imaging.BitmapFrame.Create(iconStream);
            } catch { }

            WindowChrome.SetWindowChrome(this, new WindowChrome {
                CaptionHeight = 0,
                ResizeBorderThickness = new Thickness(6),
                GlassFrameThickness = new Thickness(0),
                CornerRadius = new CornerRadius(0),
                UseAeroCaptionButtons = false
            });

            BuildUI();

            if (preloaded != null) {
                SetManifest(preloaded);
            } else {
                state = UpState.Checking;
                Loaded += async (s, e) => await CheckAsync();
            }
            Render();
            ContentRendered += (s, e) => { Topmost = false; Activate(); };
            // 自動更新：啟動時發現新版即自動下載、驗證並啟動安裝器（不需按鈕）；強制更新同樣自動。
            ContentRendered += (s, e) => {
                if (!manual && state == UpState.Available && UpdateState.Load().AutoInstall) OnPrimary();
            };
            Closing += (s, e) => OnClosingWindow(e);
        }

        public int ExitCode { get { return exitCode; } }

        private string T(string zh, string en) { return lang == "en" ? en : zh; }

        private void SetManifest(UpdateManifest m) {
            manifest = m;
            if (UpdateCommon.IsNewer(m.Version, currentVersion)) {
                forced = m.IsForcedFor(currentVersion);
                state = UpState.Available;
            } else {
                state = UpState.UpToDate;
            }
        }

        private async Task CheckAsync() {
            state = UpState.Checking; Render();
            UpdateState.Update(s => { s.Phase = "checking"; });
            try {
                UpdateManifest m = await Task.Run(() => UpdateCommon.FetchManifest(10000));
                SetManifest(m);
                UpdateState.Update(s => { s.Phase = "idle"; s.LastCheckUtc = DateTime.UtcNow.ToString("o"); s.LastCheckResult = "ok"; s.LatestVersion = m.Version; s.LastError = null; });
            } catch (Exception ex) {
                UpdateCommon.Log("Manual check failed: " + ex);
                errorDetail = ex.Message;
                state = UpState.CheckError;
                UpdateState.Update(s => { s.Phase = "error"; s.LastCheckUtc = DateTime.UtcNow.ToString("o"); s.LastCheckResult = "error"; s.LastError = ex.Message; });
            }
            Render();
        }

    }
}
