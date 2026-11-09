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
        private Grid BuildCards() {
            // 核心內容區
            Grid cardContainer = new Grid {
                VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalAlignment = HorizontalAlignment.Stretch
            };
            BuildConfigCard();
            BuildProgressCard();
            BuildCompleteCard();
            cardContainer.Children.Add(cardConfig);
            cardContainer.Children.Add(cardProgress);
            cardContainer.Children.Add(cardComplete);

            Grid.SetRow(cardContainer, 1);
            return cardContainer;
        }

        private void BuildConfigCard() {
            // 卡片 1：設定
            cardConfig = CreateStepCard();
            StackPanel cfgStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

            txtLblPath = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = BrushInkSoft,
                Margin = new Thickness(0, 0, 0, 8)
            };

            Grid pathRow = new Grid { Margin = new Thickness(0, 0, 0, 16) };
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string defaultPath = Path.Combine(localApp, "JudgeResearch");

            txtInstallPath = new TextBox {
                Text = defaultPath,
                FontFamily = new FontFamily("Consolas, Courier New, monospace"),
                FontSize = 13,
                Foreground = BrushInk,
                Background = Brushes.White,
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1, 1, 1, 2),
                Padding = new Thickness(10, 8, 10, 8),
                VerticalContentAlignment = VerticalAlignment.Center
            };
            Grid.SetColumn(txtInstallPath, 0);
            pathRow.Children.Add(txtInstallPath);

            btnBrowse = CreateOutlinedButton("［ 瀏覽 ］", 12);
            btnBrowse.Margin = new Thickness(10, 0, 0, 0);
            btnBrowse.Padding = new Thickness(16, 7, 16, 7);
            btnBrowse.Click += (s, e) => BrowseInstallPath();
            Grid.SetColumn(btnBrowse, 1);
            pathRow.Children.Add(btnBrowse);

            chkDesktop = new CheckBox {
                IsChecked = true,
                Margin = new Thickness(0, 4, 0, 8),
                VerticalContentAlignment = VerticalAlignment.Center
            };
            txtLblDesktop = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInk,
                Margin = new Thickness(6, 0, 0, 0)
            };
            chkDesktop.Content = txtLblDesktop;

            chkStartMenu = new CheckBox {
                IsChecked = true,
                Margin = new Thickness(0, 0, 0, 16),
                VerticalContentAlignment = VerticalAlignment.Center
            };
            txtLblStartMenu = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInk,
                Margin = new Thickness(6, 0, 0, 0)
            };
            chkStartMenu.Content = txtLblStartMenu;

            Border dashLine = new Border {
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(0, 1, 0, 0),
                Margin = new Thickness(0, 4, 0, 10)
            };

            txtSizeBadge = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 11,
                Foreground = BrushInkFaint,
                LineHeight = 18
            };

            cfgStack.Children.Add(txtLblPath);
            cfgStack.Children.Add(pathRow);
            cfgStack.Children.Add(chkDesktop);
            cfgStack.Children.Add(chkStartMenu);
            cfgStack.Children.Add(dashLine);
            cfgStack.Children.Add(txtSizeBadge);
            cardConfig.Child = cfgStack;
        }

        private void BuildProgressCard() {
            // 卡片 2：進度
            cardProgress = CreateStepCard();
            cardProgress.Visibility = Visibility.Collapsed;
            StackPanel prgStack = new StackPanel {
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Margin = new Thickness(24, 0, 24, 0)
            };

            txtProgressTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 16,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                Margin = new Thickness(0, 0, 0, 16)
            };

            prgBar = new ProgressBar {
                Height = 8,
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Foreground = BrushShu,
                Background = new SolidColorBrush(Color.FromRgb(0xDC, 0xD3, 0xC1)),
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1)
            };

            Grid prgStatusRow = new Grid { Margin = new Thickness(0, 12, 0, 0) };
            txtProgressStatus = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInkSoft,
                HorizontalAlignment = HorizontalAlignment.Left
            };
            txtProgressPct = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                HorizontalAlignment = HorizontalAlignment.Right
            };
            prgStatusRow.Children.Add(txtProgressStatus);
            prgStatusRow.Children.Add(txtProgressPct);

            prgStack.Children.Add(txtProgressTitle);
            prgStack.Children.Add(prgBar);
            prgStack.Children.Add(prgStatusRow);
            cardProgress.Child = prgStack;
        }

        private void BuildCompleteCard() {
            // 卡片 3：完成
            cardComplete = CreateStepCard();
            cardComplete.Visibility = Visibility.Collapsed;
            StackPanel cmpStack = new StackPanel {
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center
            };

            Border sealLarge = new Border {
                Width = 64,
                Height = 64,
                BorderBrush = BrushShu,
                BorderThickness = new Thickness(2),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 16)
            };
            TextBlock txtSealLarge = new TextBlock {
                Text = "完",
                FontFamily = FontMincho,
                FontSize = 30,
                FontWeight = FontWeights.Bold,
                Foreground = BrushShu,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            sealLarge.Child = txtSealLarge;

            txtCompleteTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 20,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 10)
            };

            txtCompleteDesc = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 13,
                Foreground = BrushInkSoft,
                LineHeight = 22,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center
            };

            cmpStack.Children.Add(sealLarge);
            cmpStack.Children.Add(txtCompleteTitle);
            cmpStack.Children.Add(txtCompleteDesc);
            cardComplete.Child = cmpStack;
        }
    }
}
