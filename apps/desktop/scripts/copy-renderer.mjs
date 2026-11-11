// 把渲染程序的靜態檔案複製到 dist/renderer（渲染程序不需要編譯）。
// 共用畫面（@judge/ui）的產物另外複製到 dist/renderer/ui。
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/renderer', { recursive: true });
cpSync('src/renderer', 'dist/renderer', { recursive: true });
mkdirSync('dist/renderer/ui', { recursive: true });
cpSync('node_modules/@judge/ui/dist', 'dist/renderer/ui', { recursive: true });
console.log('renderer copied');
