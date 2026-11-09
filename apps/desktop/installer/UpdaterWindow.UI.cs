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
        private void BuildUI() {
            Grid root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(44) });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            Border titleBar = new Border {
                Background = BrushDarkBar,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x36, 0x30, 0x27)),
                BorderThickness = new Thickness(0, 0, 0, 1)
            };
            titleBar.MouseDown += (s, e) => { if (e.LeftButton == MouseButtonState.Pressed) DragMove(); };

            Grid tg = new Grid();
            tg.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            tg.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel tl = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(16, 0, 0, 0) };
            Border seal = new Border { Width = 24, Height = 24, Background = BrushShu, CornerRadius = new CornerRadius(2), Margin = new Thickness(0, 0, 10, 0) };
            seal.Child = new TextBlock { Text = "判", Foreground = Brushes.White, FontWeight = FontWeights.Bold, FontSize = 13, FontFamily = FontMincho, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            txtTitleBar = new TextBlock { Foreground = new SolidColorBrush(Color.FromRgb(0xED, 0xE5, 0xD5)), FontSize = 13, FontWeight = FontWeights.Medium, VerticalAlignment = VerticalAlignment.Center };
            tl.Children.Add(seal); tl.Children.Add(txtTitleBar);
            tg.Children.Add(tl);

            StackPanel tr = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
            btnToggleLang = CreateTitleBarButton("English", 11);
            btnToggleLang.Click += (s, e) => { lang = lang == "en" ? "zh" : "en"; SaveLang(); Render(); };
            Button btnMin = CreateGlyphButton("―", 11);
            btnMin.Click += (s, e) => WindowState = WindowState.Minimized;
            btnClose = CreateGlyphButton("✕", 13);
            btnClose.Click += (s, e) => Close();
            tr.Children.Add(btnToggleLang); tr.Children.Add(btnMin); tr.Children.Add(btnClose);
            Grid.SetColumn(tr, 1);
            tg.Children.Add(tr);
            titleBar.Child = tg;
            root.Children.Add(titleBar);

            Border content = new Border { Padding = new Thickness(40, 26, 40, 22), Background = BrushPaper };
            Grid main = new Grid();
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            main.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            StackPanel header = new StackPanel { Margin = new Thickness(0, 0, 0, 16) };
            txtKicker = new TextBlock { FontFamily = FontRoman, FontSize = 11, Foreground = BrushInkFaint, Margin = new Thickness(0, 0, 0, 4) };
            txtPageTitle = new TextBlock { FontFamily = FontMincho, FontSize = 24, FontWeight = FontWeights.Bold, Foreground = BrushInk, Margin = new Thickness(0, 0, 0, 6) };
            txtPageLead = new TextBlock { FontFamily = FontMincho, FontSize = 13, Foreground = BrushInkSoft, LineHeight = 21, TextWrapping = TextWrapping.Wrap };
            header.Children.Add(txtKicker); header.Children.Add(txtPageTitle); header.Children.Add(txtPageLead);
            header.Children.Add(new Border { BorderBrush = BrushHair, BorderThickness = new Thickness(0, 0, 0, 1), Margin = new Thickness(0, 12, 0, 0) });
            main.Children.Add(header);

            Grid cards = new Grid();
            cards.Children.Add(cardInfo = BuildInfoCard());
            cards.Children.Add(cardProgress = BuildProgressCard());
            cards.Children.Add(cardMessage = BuildMessageCard());
            Grid.SetRow(cards, 1);
            main.Children.Add(cards);

            Grid foot = new Grid { Margin = new Thickness(0, 16, 0, 0) };
            foot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            txtFootNote = new TextBlock { FontFamily = FontMincho, FontSize = 11, Foreground = BrushInkFaint, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 12, 0) };
            foot.Children.Add(txtFootNote);
            StackPanel bp = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            btnSecondary = CreateOutlinedButton("", 12);
            btnSecondary.Padding = new Thickness(20, 8, 20, 8);
            btnSecondary.Margin = new Thickness(0, 0, 12, 0);
            btnSecondary.Click += (s, e) => OnSecondary();
            btnPrimary = CreateVermilionButton("", 13);
            btnPrimary.Padding = new Thickness(26, 8, 26, 8);
            btnPrimary.Click += (s, e) => OnPrimary();
            bp.Children.Add(btnSecondary); bp.Children.Add(btnPrimary);
            Grid.SetColumn(bp, 1);
            foot.Children.Add(bp);
            Grid.SetRow(foot, 2);
            main.Children.Add(foot);

            content.Child = main;
            Grid.SetRow(content, 1);
            root.Children.Add(content);
            Content = root;
        }

        private Border BuildInfoCard() {
            Border card = CreateCard();
            Grid g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            Grid ver = new Grid();
            ver.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ver.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ver.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ver.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            StackPanel cur = new StackPanel();
            lblCurrent = new TextBlock { FontFamily = FontGothic, FontSize = 11, Foreground = BrushInkFaint };
            valCurrent = new TextBlock { FontFamily = FontRoman, FontSize = 26, Foreground = BrushInkSoft };
            cur.Children.Add(lblCurrent); cur.Children.Add(valCurrent);

            TextBlock arrow = new TextBlock { Text = "→", FontSize = 22, Foreground = BrushInkFaint, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(22, 0, 22, 4) };

            StackPanel lat = new StackPanel();
            lblLatest = new TextBlock { FontFamily = FontGothic, FontSize = 11, Foreground = BrushShu };
            valLatest = new TextBlock { FontFamily = FontRoman, FontSize = 26, FontWeight = FontWeights.Bold, Foreground = BrushShu };
            lat.Children.Add(lblLatest); lat.Children.Add(valLatest);

            Grid.SetColumn(arrow, 1); Grid.SetColumn(lat, 2);
            ver.Children.Add(cur); ver.Children.Add(arrow); ver.Children.Add(lat);
            g.Children.Add(ver);

            txtMeta = new TextBlock { FontFamily = FontGothic, FontSize = 11, Foreground = BrushInkFaint, Margin = new Thickness(0, 6, 0, 0) };
            Grid.SetRow(txtMeta, 1);
            g.Children.Add(txtMeta);

            lblNotes = new TextBlock { FontFamily = FontGothic, FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = BrushInkSoft, Margin = new Thickness(0, 14, 0, 6) };
            Grid.SetRow(lblNotes, 2);
            g.Children.Add(lblNotes);

            txtNotes = new TextBlock { FontFamily = FontMincho, FontSize = 13, Foreground = BrushInk, LineHeight = 22, TextWrapping = TextWrapping.Wrap };
            ScrollViewer sv = new ScrollViewer {
                Content = txtNotes,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Padding = new Thickness(12, 8, 12, 8),
                Background = Brushes.White,
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1),
                MinHeight = 60
            };
            Border svWrap = new Border { BorderBrush = BrushHair, BorderThickness = new Thickness(1), Child = sv };
            Grid.SetRow(svWrap, 3);
            g.Children.Add(svWrap);

            StackPanel bottom = new StackPanel { Margin = new Thickness(0, 12, 0, 0) };
            forcedBanner = new Border { Background = BrushShuWash, BorderBrush = BrushShu, BorderThickness = new Thickness(3, 0, 0, 0), Padding = new Thickness(12, 8, 12, 8) };
            txtForced = new TextBlock { FontFamily = FontGothic, FontSize = 12, Foreground = BrushShuHover, TextWrapping = TextWrapping.Wrap, LineHeight = 19 };
            forcedBanner.Child = txtForced;
            chkSnooze = new CheckBox { VerticalContentAlignment = VerticalAlignment.Center, Cursor = Cursors.Hand };
            txtSnooze = new TextBlock { FontFamily = FontGothic, FontSize = 12, Foreground = BrushInk, Margin = new Thickness(6, 0, 0, 0) };
            chkSnooze.Content = txtSnooze;
            bottom.Children.Add(forcedBanner); bottom.Children.Add(chkSnooze);
            Grid.SetRow(bottom, 4);
            g.Children.Add(bottom);

            card.Child = g;
            return card;
        }

        private Border BuildProgressCard() {
            Border card = CreateCard();
            StackPanel sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(20, 0, 20, 0) };
            txtProgressTitle = new TextBlock { FontFamily = FontMincho, FontSize = 16, FontWeight = FontWeights.Bold, Foreground = BrushInk, Margin = new Thickness(0, 0, 0, 16) };
            prgBar = new ProgressBar { Height = 8, Minimum = 0, Maximum = 100, Foreground = BrushShu, Background = new SolidColorBrush(Color.FromRgb(0xDC, 0xD3, 0xC1)), BorderBrush = BrushHair, BorderThickness = new Thickness(1) };
            Grid row = new Grid { Margin = new Thickness(0, 12, 0, 0) };
            txtProgressStatus = new TextBlock { FontFamily = FontGothic, FontSize = 12, Foreground = BrushInkSoft };
            txtProgressPct = new TextBlock { FontFamily = FontGothic, FontSize = 12, FontWeight = FontWeights.Bold, Foreground = BrushInk, HorizontalAlignment = HorizontalAlignment.Right };
            row.Children.Add(txtProgressStatus); row.Children.Add(txtProgressPct);
            sp.Children.Add(txtProgressTitle); sp.Children.Add(prgBar); sp.Children.Add(row);
            card.Child = sp;
            return card;
        }

        private Border BuildMessageCard() {
            Border card = CreateCard();
            StackPanel sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
            sealMsg = new Border { Width = 64, Height = 64, BorderBrush = BrushShu, BorderThickness = new Thickness(2), HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 16) };
            txtSealMsg = new TextBlock { FontFamily = FontMincho, FontSize = 30, FontWeight = FontWeights.Bold, Foreground = BrushShu, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            sealMsg.Child = txtSealMsg;
            txtMsgTitle = new TextBlock { FontFamily = FontMincho, FontSize = 19, FontWeight = FontWeights.Bold, Foreground = BrushInk, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 10) };
            txtMsgDesc = new TextBlock { FontFamily = FontMincho, FontSize = 13, Foreground = BrushInkSoft, LineHeight = 22, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxWidth = 520 };
            sp.Children.Add(sealMsg); sp.Children.Add(txtMsgTitle); sp.Children.Add(txtMsgDesc);
            card.Child = sp;
            return card;
        }

    }
}
