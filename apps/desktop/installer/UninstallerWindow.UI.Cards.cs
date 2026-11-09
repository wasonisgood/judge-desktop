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
        private Grid BuildCards() {
            // 中央卡片容器
            Grid cardContainer = new Grid {
                VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalAlignment = HorizontalAlignment.Stretch
            };
            BuildSurveyCard();
            BuildProgressCard();
            BuildFarewellCard();
            cardContainer.Children.Add(cardSurvey);
            cardContainer.Children.Add(cardProgress);
            cardContainer.Children.Add(cardFarewell);
            Grid.SetRow(cardContainer, 1);
            return cardContainer;
        }

        private void BuildSurveyCard() {
            // 卡片 1：保留選項與意見卡片
            cardSurvey = CreateStepCard();
            ScrollViewer surveyScroll = new ScrollViewer {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
            };

            StackPanel surveyStack = new StackPanel();

            // 挽回區塊
            Border retainBox = new Border {
                Background = new SolidColorBrush(Color.FromRgb(0xFC, 0xFA, 0xF5)),
                BorderBrush = BrushShu,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(18, 14, 18, 14),
                Margin = new Thickness(0, 0, 0, 18)
            };
            Grid retainGrid = new Grid();
            retainGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            retainGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel retainTextStack = new StackPanel();
            txtRetainTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 14,
                FontWeight = FontWeights.Bold,
                Foreground = BrushShu,
                Margin = new Thickness(0, 0, 0, 4)
            };
            txtRetainDesc = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 12,
                Foreground = BrushInkSoft,
                LineHeight = 18
            };
            retainTextStack.Children.Add(txtRetainTitle);
            retainTextStack.Children.Add(txtRetainDesc);
            Grid.SetColumn(retainTextStack, 0);
            retainGrid.Children.Add(retainTextStack);

            StackPanel retainBtnStack = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };
            btnRetainApp = CreateVermilionButton("［ 保留程式 ］", 12);
            btnRetainApp.Padding = new Thickness(16, 7, 16, 7);
            btnRetainApp.Click += (s, e) => Close();

            btnResetCacheOnly = CreateOutlinedButton("［ 僅清除本機快取 ］", 11);
            btnResetCacheOnly.Padding = new Thickness(12, 6, 12, 6);
            btnResetCacheOnly.Margin = new Thickness(8, 0, 0, 0);
            btnResetCacheOnly.Click += (s, e) => DoResetCache();

            retainBtnStack.Children.Add(btnRetainApp);
            retainBtnStack.Children.Add(btnResetCacheOnly);
            Grid.SetColumn(retainBtnStack, 1);
            retainGrid.Children.Add(retainBtnStack);

            retainBox.Child = retainGrid;
            surveyStack.Children.Add(retainBox);

            // 問卷題目區塊
            txtSurveyLabel = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = BrushInk,
                Margin = new Thickness(0, 0, 0, 10)
            };
            surveyStack.Children.Add(txtSurveyLabel);

            chkReason1 = CreateReasonCheck(out txtReason1);
            chkReason2 = CreateReasonCheck(out txtReason2);
            chkReason3 = CreateReasonCheck(out txtReason3);
            chkReason4 = CreateReasonCheck(out txtReason4);

            surveyStack.Children.Add(chkReason1);
            surveyStack.Children.Add(chkReason2);
            surveyStack.Children.Add(chkReason3);
            surveyStack.Children.Add(chkReason4);

            txtFeedback = new TextBox {
                Height = 44,
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInk,
                Background = Brushes.White,
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 10, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                AcceptsReturn = true,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto
            };
            surveyStack.Children.Add(txtFeedback);

            surveyScroll.Content = surveyStack;
            cardSurvey.Child = surveyScroll;
        }

        private void BuildProgressCard() {
            // 卡片 2：卸載進度展示
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

        private void BuildFarewellCard() {
            // 卡片 3：道別完成畫面
            cardFarewell = CreateStepCard();
            cardFarewell.Visibility = Visibility.Collapsed;
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
                Text = "緣",
                FontFamily = FontMincho,
                FontSize = 30,
                FontWeight = FontWeights.Bold,
                Foreground = BrushShu,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            sealLarge.Child = txtSealLarge;

            txtFarewellTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 20,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 10)
            };

            txtFarewellDesc = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 13,
                Foreground = BrushInkSoft,
                LineHeight = 22,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 20)
            };

            btnFarewellClose = CreateVermilionButton("［ 關閉 ］", 13);
            btnFarewellClose.Padding = new Thickness(30, 8, 30, 8);
            btnFarewellClose.HorizontalAlignment = HorizontalAlignment.Center;
            btnFarewellClose.Click += (s, e) => FinalizeSelfDeleteAndClose();

            cmpStack.Children.Add(sealLarge);
            cmpStack.Children.Add(txtFarewellTitle);
            cmpStack.Children.Add(txtFarewellDesc);
            cmpStack.Children.Add(btnFarewellClose);
            cardFarewell.Child = cmpStack;
        }
    }
}
