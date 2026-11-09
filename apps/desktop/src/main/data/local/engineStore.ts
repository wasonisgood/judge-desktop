// 本地資料層：引擎紀錄（engine.json）、方案（plan.json）與硬體快取（hardware.json）。
import * as path from 'node:path';
import type { HardwareInfo, LocalPlan, NativeArch } from '@judge/core';
import { engineRoot } from './localPaths';
import { readJson, writeJson } from './jsonFile';

export interface EngineRecord {
  mode: 'own' | 'external' | null;
  baseUrl: string | null;
  version: string | null;
  asset: string | null;
  arch: NativeArch | null;
  zipSha256: string | null;
  exePath: string | null;
  exeSha256: string | null;
  installedAt: string | null;
}

export const EMPTY_ENGINE: EngineRecord = { mode: null, baseUrl: null, version: null, asset: null, arch: null, zipSha256: null, exePath: null, exeSha256: null, installedAt: null };

export interface HardwareCache {
  hardware: HardwareInfo;
  nativeArch: NativeArch;
  at: string;
}

export const readEngine = () => readJson<EngineRecord>(path.join(engineRoot(), 'engine.json'), EMPTY_ENGINE);
export const writeEngine = (r: EngineRecord) => writeJson(path.join(engineRoot(), 'engine.json'), r);
export const readPlan = () => readJson<LocalPlan | null>(path.join(engineRoot(), 'plan.json'), null);
export const writePlan = (p: LocalPlan) => writeJson(path.join(engineRoot(), 'plan.json'), p);
export const readHardwareCache = () => readJson<HardwareCache | null>(path.join(engineRoot(), 'hardware.json'), null);
export const writeHardwareCache = (hardware: HardwareInfo, nativeArch: NativeArch) =>
  writeJson(path.join(engineRoot(), 'hardware.json'), { hardware, nativeArch, at: new Date().toISOString() });
