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
        private Border CreateCard() {
            return new Border { Background = BrushPaperCard, BorderBrush = BrushHair, BorderThickness = new Thickness(1), Padding = new Thickness(28, 22, 28, 20), Visibility = Visibility.Collapsed };
        }

        private Button CreateTitleBarButton(string text, double fontSize) {
            Button b = new Button {
                Content = text, FontSize = fontSize, FontFamily = FontGothic,
                Foreground = new SolidColorBrush(Color.FromRgb(0xCB, 0xBF, 0xA8)), Background = Brushes.Transparent,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x55, 0x4A, 0x3E)), BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 2, 8, 2), Margin = new Thickness(0, 0, 10, 0), Cursor = Cursors.Hand
            };
            b.MouseEnter += (s, e) => b.Background = new SolidColorBrush(Color.FromRgb(0x2C, 0x25, 0x1F));
            b.MouseLeave += (s, e) => b.Background = Brushes.Transparent;
            return b;
        }

        private Button CreateGlyphButton(string glyph, double fontSize) {
            var idle = new SolidColorBrush(Color.FromRgb(0x8C, 0x82, 0x70));
            Button b = new Button {
                Content = glyph, FontSize = fontSize, FontFamily = FontMincho, Foreground = idle,
                Background = Brushes.Transparent, BorderThickness = new Thickness(0), Width = 32, Height = 32, Cursor = Cursors.Hand
            };
            b.MouseEnter += (s, e) => { b.Background = glyph == "✕" ? BrushShu : new SolidColorBrush(Color.FromRgb(0x2C, 0x25, 0x1F)); b.Foreground = Brushes.White; };
            b.MouseLeave += (s, e) => { b.Background = Brushes.Transparent; b.Foreground = idle; };
            return b;
        }

        private Button CreateOutlinedButton(string text, double fontSize) {
            Button b = new Button {
                Content = text, FontSize = fontSize, FontFamily = FontGothic, FontWeight = FontWeights.SemiBold,
                Foreground = BrushInk, Background = Brushes.Transparent, BorderBrush = BrushRule, BorderThickness = new Thickness(1), Cursor = Cursors.Hand
            };
            b.MouseEnter += (s, e) => { b.Background = BrushInk; b.Foreground = BrushPaper; };
            b.MouseLeave += (s, e) => { b.Background = Brushes.Transparent; b.Foreground = BrushInk; };
            return b;
        }

        private Button CreateVermilionButton(string text, double fontSize) {
            Button b = new Button {
                Content = text, FontSize = fontSize, FontFamily = FontGothic, FontWeight = FontWeights.Bold,
                Foreground = Brushes.White, Background = BrushShu, BorderBrush = BrushShu, BorderThickness = new Thickness(1), Cursor = Cursors.Hand
            };
            b.MouseEnter += (s, e) => { b.Background = BrushShuHover; b.BorderBrush = BrushShuHover; };
            b.MouseLeave += (s, e) => { b.Background = BrushShu; b.BorderBrush = BrushShu; };
            return b;
        }
    }
}
