// 視窗狀態：主視窗與本地模組精靈視窗的參照（只在這裡保存，其他模組透過函數讀取）。
import type { BrowserWindow } from 'electron';

let mainWin: BrowserWindow | null = null;
let wizardWin: BrowserWindow | null = null;

export const getMainWindow = () => mainWin;
export const setMainWindow = (w: BrowserWindow | null) => { mainWin = w; };
export const getWizardWindow = () => wizardWin;
export const setWizardWindow = (w: BrowserWindow | null) => { wizardWin = w; };
