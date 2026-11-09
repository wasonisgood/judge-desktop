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
        private void ToggleMaximize() {
            if (isMaximized) {
                Left = normalBounds.Left;
                Top = normalBounds.Top;
                Width = normalBounds.Width;
                Height = normalBounds.Height;
                isMaximized = false;
                btnMaximize.Content = "□";
            } else {
                normalBounds = new Rect(Left, Top, Width, Height);
                var workArea = SystemParameters.WorkArea;
                Left = workArea.Left;
                Top = workArea.Top;
                Width = workArea.Width;
                Height = workArea.Height;
                isMaximized = true;
                btnMaximize.Content = "❐";
            }
        }

        private Border CreateStepCard() {
            return new Border {
                Background = BrushPaperCard,
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(32, 28, 32, 28),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch
            };
        }

        private Button CreateTitleBarButton(string text, double fontSize) {
            Button btn = new Button {
                Content = text,
                FontSize = fontSize,
                FontFamily = FontGothic,
                Foreground = new SolidColorBrush(Color.FromRgb(0xCB, 0xBF, 0xA8)),
                Background = Brushes.Transparent,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x55, 0x4A, 0x3E)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 2, 8, 2),
                Margin = new Thickness(0, 0, 10, 0),
                Cursor = Cursors.Hand
            };
            btn.MouseEnter += (s, e) => btn.Background = new SolidColorBrush(Color.FromRgb(0x2C, 0x25, 0x1F));
            btn.MouseLeave += (s, e) => btn.Background = Brushes.Transparent;
            return btn;
        }

        private Button CreateTitleBarGlyphButton(string glyph, double fontSize) {
            Button btn = new Button {
                Content = glyph,
                FontSize = fontSize,
                FontFamily = FontMincho,
                Foreground = new SolidColorBrush(Color.FromRgb(0x8C, 0x82, 0x70)),
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Width = 32,
                Height = 32,
                Cursor = Cursors.Hand,
                VerticalContentAlignment = VerticalAlignment.Center,
                HorizontalContentAlignment = HorizontalAlignment.Center
            };
            btn.MouseEnter += (s, e) => {
                btn.Background = (glyph == "✕") ? BrushShu : new SolidColorBrush(Color.FromRgb(0x2C, 0x25, 0x1F));
                btn.Foreground = Brushes.White;
            };
            btn.MouseLeave += (s, e) => {
                btn.Background = Brushes.Transparent;
                btn.Foreground = new SolidColorBrush(Color.FromRgb(0x8C, 0x82, 0x70));
            };
            return btn;
        }

        private Button CreateOutlinedButton(string text, double fontSize) {
            Button btn = new Button {
                Content = text,
                FontSize = fontSize,
                FontFamily = FontGothic,
                FontWeight = FontWeights.SemiBold,
                Foreground = BrushInk,
                Background = Brushes.Transparent,
                BorderBrush = BrushRule,
                BorderThickness = new Thickness(1),
                Cursor = Cursors.Hand
            };
            btn.MouseEnter += (s, e) => {
                btn.Background = BrushInk;
                btn.Foreground = BrushPaper;
            };
            btn.MouseLeave += (s, e) => {
                btn.Background = Brushes.Transparent;
                btn.Foreground = BrushInk;
            };
            return btn;
        }

        private Button CreateVermilionButton(string text, double fontSize) {
            Button btn = new Button {
                Content = text,
                FontSize = fontSize,
                FontFamily = FontGothic,
                FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                Background = BrushShu,
                BorderBrush = BrushShu,
                BorderThickness = new Thickness(1),
                Cursor = Cursors.Hand
            };
            btn.MouseEnter += (s, e) => {
                btn.Background = BrushShuHover;
                btn.BorderBrush = BrushShuHover;
            };
            btn.MouseLeave += (s, e) => {
                btn.Background = BrushShu;
                btn.BorderBrush = BrushShu;
            };
            return btn;
        }

        private void BrowseInstallPath() {
            using (var dialog = new System.Windows.Forms.FolderBrowserDialog()) {
                dialog.Description = (currentLang == "en")
                    ? "Select destination folder for Judge Research:"
                    : "請選擇司法院裁判研究的安裝目標資料夾：";
                dialog.SelectedPath = txtInstallPath.Text;
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK) {
                    txtInstallPath.Text = dialog.SelectedPath;
                }
            }
        }

        private void UpdateLanguage() {
            bool en = currentLang == "en";
            Title = en ? "Judge Research — Installation Setup" : "司法院裁判研究 — 安裝指南";
            btnToggleLang.Content = en ? "切換繁體中文" : "English";
            txtTitleBar.Text = en ? "Judge Research ・ Setup Guide" : "司法院裁判研究 ・ 安裝指南";

            if (isUpgrade) {
                txtKicker.Text = "JUDGE RESEARCH · UPGRADE";
                txtPageTitle.Text = en ? "Upgrade Judge Research" : "升級 司法院裁判研究";
                txtPageLead.Text = en
                    ? "Upgrading from v" + installedVersion + " to v" + BuildInfo.Version + ". Your settings, AI key and local cache will be kept."
                    : "即將從現有版本 v" + installedVersion + " 升級至 v" + BuildInfo.Version + "。您的設定、AI 金鑰與本機快取將完整保留。";
                btnAction.Content = en ? "［ Begin Upgrade ］" : "［ 開始升級 ］";
            } else if (isRepairMode) {
                txtKicker.Text = "JUDGE RESEARCH · REPAIR";
                txtPageTitle.Text = en ? "Reinstall / Repair Research Desk" : "重新安裝 / 修復 應用程式";
                txtPageLead.Text = en
                    ? "Existing installation detected (v" + (installedVersion ?? BuildInfo.Version) + "). Program files will be replaced and the Windows registration refreshed."
                    : "系統中已偵測到已安裝之應用程式（v" + (installedVersion ?? BuildInfo.Version) + "）。將覆寫程式核心檔案並重新校正系統註冊。";
                btnAction.Content = en ? "［ Repair / Reinstall ］" : "［ 重新安裝 / 修復 ］";
            } else {
                txtKicker.Text = "JUDGE RESEARCH · INSTALL";
                txtPageTitle.Text = en ? "Install Judge Research" : "部署 司法院裁判研究";
                txtPageLead.Text = en
                    ? "Search, list and analyze Judicial Yuan judgments, build scope tables and single-judgment briefs."
                    : "司法院判決的檢索、列表生成、綜合分析與單一判決精讀桌面端。將完整解壓部署程式核心與系統註冊。";
                btnAction.Content = en ? "［ Begin Installation ］" : "［ 開始安裝 ］";
            }

            txtLblPath.Text = en ? "Destination Directory" : "安裝目的地資料夾";
            btnBrowse.Content = en ? "［ Browse ］" : "［ 瀏覽 ］";
            txtLblDesktop.Text = en ? "Create Desktop Shortcut (司法院裁判研究)" : "建立桌面捷徑（司法院裁判研究）";
            txtLblStartMenu.Text = en ? "Register in Start Menu Programs" : "於開始功能表「所有程式」建立捷徑";
            txtSizeBadge.Text = en
                ? string.Format("Required disk space: about {0} MB", RequiredMb())
                : string.Format("需要磁碟空間：約 {0} MB", RequiredMb());

            btnCancel.Content = en ? "［ Cancel ］" : "［ 取消 ］";
            txtFootNote.Text = en
                ? "© wasonisgood  v" + BuildInfo.Version
                : "© 司法院裁判研究 / wasonisgood  v" + BuildInfo.Version;
        }

    }
}
