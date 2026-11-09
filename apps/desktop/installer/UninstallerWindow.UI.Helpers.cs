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
        private CheckBox CreateReasonCheck(out TextBlock txtLabel) {
            CheckBox chk = new CheckBox {
                Margin = new Thickness(0, 3, 0, 5),
                VerticalContentAlignment = VerticalAlignment.Center
            };
            txtLabel = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInk,
                Margin = new Thickness(6, 0, 0, 0)
            };
            chk.Content = txtLabel;
            return chk;
        }

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
                Padding = new Thickness(28, 22, 28, 22),
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

        private void DoResetCache() {
            string[] userDataDirs = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "JudgeResearch"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "judge-research-desk")
            };
            string[] cacheDirs = { "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "GPUPersistentCache", "ShaderCache", "Service Worker\\CacheStorage" };

            foreach (Process p in Process.GetProcessesByName("JudgeResearch")) {
                try { p.Kill(); p.WaitForExit(2000); } catch { }
            }
            foreach (Process p in Process.GetProcessesByName("司法院裁判研究")) {
                try { p.Kill(); p.WaitForExit(2000); } catch { }
            }

            foreach (string uData in userDataDirs) {
                if (!Directory.Exists(uData)) continue;
                foreach (string d in cacheDirs) {
                    try {
                        string full = Path.Combine(uData, d);
                        if (Directory.Exists(full)) Directory.Delete(full, true);
                    } catch { }
                }
            }

            string msg = (currentLang == "en")
                ? "Local temporary cache and search indexes have been cleared.\nYour judge database, memorials and settings are fully preserved!"
                : "已為您清除本機快取。\n您的爭點題庫、手稿筆記與雲端連線均已完整保留，您可隨時繼續秒開使用！";
            MessageBox.Show(msg, "Cache Cleared", MessageBoxButton.OK, MessageBoxImage.Information);
            Close();
        }

    }
}
