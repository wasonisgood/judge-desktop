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
        private void BuildUI() {
            Grid rootGrid = new Grid();
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(44, GridUnitType.Pixel) });
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            rootGrid.Children.Add(BuildTitleBar());
            rootGrid.Children.Add(BuildContentBorder());
            Content = rootGrid;
        }

        private Border BuildTitleBar() {
            // 1. 自繪頂部標題列
            Border titleBar = new Border {
                Background = BrushDarkBar,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x36, 0x30, 0x27)),
                BorderThickness = new Thickness(0, 0, 0, 1)
            };
            titleBar.MouseDown += (s, e) => {
                if (e.LeftButton == MouseButtonState.Pressed) {
                    if (e.ClickCount == 2) ToggleMaximize(); else DragMove();
                }
            };

            Grid titleGrid = new Grid();
            titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel titleLeft = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(16, 0, 0, 0)
            };

            Border sealBox = new Border {
                Width = 24,
                Height = 24,
                Background = BrushShu,
                CornerRadius = new CornerRadius(2),
                Margin = new Thickness(0, 0, 10, 0)
            };
            TextBlock txtSeal = new TextBlock {
                Text = "判",
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                FontSize = 13,
                FontFamily = FontMincho,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            sealBox.Child = txtSeal;

            txtTitleBar = new TextBlock {
                Foreground = new SolidColorBrush(Color.FromRgb(0xED, 0xE5, 0xD5)),
                FontSize = 13,
                FontWeight = FontWeights.Medium,
                VerticalAlignment = VerticalAlignment.Center
            };

            titleLeft.Children.Add(sealBox);
            titleLeft.Children.Add(txtTitleBar);
            Grid.SetColumn(titleLeft, 0);
            titleGrid.Children.Add(titleLeft);

            StackPanel titleRight = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 8, 0)
            };

            btnToggleLang = CreateTitleBarButton("English", 11);
            btnToggleLang.Click += (s, e) => {
                currentLang = (currentLang == "en") ? "zh" : "en";
                UpdateLanguage();
            };

            Button btnMinimize = CreateTitleBarGlyphButton("―", 11);
            btnMinimize.Click += (s, e) => WindowState = WindowState.Minimized;

            btnMaximize = CreateTitleBarGlyphButton("□", 12);
            btnMaximize.Click += (s, e) => ToggleMaximize();

            Button btnClose = CreateTitleBarGlyphButton("✕", 13);
            btnClose.Click += (s, e) => Close();

            titleRight.Children.Add(btnToggleLang);
            titleRight.Children.Add(btnMinimize);
            titleRight.Children.Add(btnMaximize);
            titleRight.Children.Add(btnClose);
            Grid.SetColumn(titleRight, 1);
            titleGrid.Children.Add(titleRight);

            titleBar.Child = titleGrid;
            Grid.SetRow(titleBar, 0);
            return titleBar;
        }

        private Border BuildContentBorder() {
            // 2. 自適應內容區
            Border contentBorder = new Border {
                Padding = new Thickness(40, 26, 40, 24),
                Background = BrushPaper
            };

            Grid mainGrid = new Grid();
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            mainGrid.Children.Add(BuildHeader());
            mainGrid.Children.Add(BuildCards());
            mainGrid.Children.Add(BuildFooter());
            contentBorder.Child = mainGrid;
            Grid.SetRow(contentBorder, 1);
            return contentBorder;
        }

        private StackPanel BuildHeader() {
            // Header 區域
            StackPanel headerStack = new StackPanel { Margin = new Thickness(0, 0, 0, 16) };
            txtKicker = new TextBlock {
                FontFamily = FontRoman,
                FontSize = 11,
                Foreground = BrushInkFaint,
                Margin = new Thickness(0, 0, 0, 4),
                Text = "MOOT COURT COMPANION DESK / UNINSTALLATION & FAREWELL"
            };
            txtPageTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 24,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                Margin = new Thickness(0, 0, 0, 6)
            };
            txtPageLead = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 12.5,
                Foreground = BrushInkSoft,
                LineHeight = 20
            };
            Border headerLine = new Border {
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Margin = new Thickness(0, 12, 0, 0)
            };

            headerStack.Children.Add(txtKicker);
            headerStack.Children.Add(txtPageTitle);
            headerStack.Children.Add(txtPageLead);
            headerStack.Children.Add(headerLine);
            Grid.SetRow(headerStack, 0);
            return headerStack;
        }

        private Grid BuildFooter() {
            // 底部按鈕區
            Grid footGrid = new Grid { Margin = new Thickness(0, 16, 0, 0) };
            footGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            txtFootNote = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 11,
                Foreground = BrushInkFaint,
                VerticalAlignment = VerticalAlignment.Center,
                Text = "© DEBATE COMPANION DESK / judge-remote-mcp-2026.web.app"
            };
            Grid.SetColumn(txtFootNote, 0);
            footGrid.Children.Add(txtFootNote);

            StackPanel btnPanel = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            btnCancel = CreateVermilionButton("［ 保留程式 ］", 12);
            btnCancel.Padding = new Thickness(22, 8, 22, 8);
            btnCancel.Margin = new Thickness(0, 0, 12, 0);
            btnCancel.Click += (s, e) => Close();

            btnConfirmUninstall = CreateOutlinedButton("［ 忍痛徹底解除安裝 ］", 12);
            btnConfirmUninstall.Padding = new Thickness(18, 8, 18, 8);
            btnConfirmUninstall.Click += (s, e) => StartUninstallWorkflow();

            btnPanel.Children.Add(btnCancel);
            btnPanel.Children.Add(btnConfirmUninstall);
            Grid.SetColumn(btnPanel, 1);
            footGrid.Children.Add(btnPanel);

            Grid.SetRow(footGrid, 2);
            return footGrid;
        }
    }
}
