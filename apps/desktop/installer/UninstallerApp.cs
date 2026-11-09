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
    public partial class UninstallerWindow : Window {
        private string currentLang = "zh";

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

        // 保留選項與意見卡片
        private Border cardSurvey;
        private Border cardProgress;
        private Border cardFarewell;

        // 保留選項
        private TextBlock txtRetainTitle;
        private TextBlock txtRetainDesc;
        private Button btnRetainApp;
        private Button btnResetCacheOnly;

        // 問卷題目
        private TextBlock txtSurveyLabel;
        private CheckBox chkReason1;
        private TextBlock txtReason1;
        private CheckBox chkReason2;
        private TextBlock txtReason2;
        private CheckBox chkReason3;
        private TextBlock txtReason3;
        private CheckBox chkReason4;
        private TextBlock txtReason4;
        private TextBox txtFeedback;

        // 底部按鈕
        private TextBlock txtFootNote;
        private Button btnCancel;
        private Button btnConfirmUninstall;

        // 進度步驟元件
        private TextBlock txtProgressTitle;
        private ProgressBar prgBar;
        private TextBlock txtProgressStatus;
        private TextBlock txtProgressPct;

        // 道別完成元件
        private TextBlock txtFarewellTitle;
        private TextBlock txtFarewellDesc;
        private Button btnFarewellClose;

        private Button btnMaximize;
        private bool isMaximized = false;
        private Rect normalBounds;

        public UninstallerWindow() {
            Title = "司法院裁判研究 ・ 解除安裝指南";
            Width = 820;
            Height = 590;
            MinWidth = 700;
            MinHeight = 500;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            Background = BrushPaper;
            Foreground = BrushInk;
            FontFamily = FontMincho;

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
            UpdateLanguage();
        }

    }
}
