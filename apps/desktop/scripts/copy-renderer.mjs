// 把渲染程序的靜態檔案複製到 dist/renderer（渲染程序不需要編譯）。
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/renderer', { recursive: true });
cpSync('src/renderer', 'dist/renderer', { recursive: true });
console.log('renderer copied');
