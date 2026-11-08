// 顯卡判讀測試：以這台 ARM64 機器實際讀到的 WMI 值（Qualcomm Adreno、AdapterRAM = 0）為依據。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHardware, detectGpuVendor, isAcceleratorVendor, planLocalAI, BUILTIN_RULES } from '../../dist/index.js';

const GB = 1024 ** 3;
const ADRENO = { name: 'Qualcomm(R) Adreno(TM) X1-85 GPU', adapterRamBytes: 0 };

test('Qualcomm Adreno 會被辨識為 qualcomm（不是 none）並保留名稱', () => {
  assert.equal(detectGpuVendor(ADRENO.name), 'qualcomm');
  const hw = parseHardware({ totalMemoryBytes: 16 * GB, freeDiskBytes: 55 * GB, gpus: [ADRENO] });
  assert.equal(hw.gpuVendor, 'qualcomm');
  assert.equal(hw.gpuName, ADRENO.name);
  assert.equal(hw.gpuMemoryShared, true, 'AdapterRAM = 0 代表共用記憶體');
  assert.equal(hw.vramGB, 0);
});

test('有顯卡但不認識的廠商 → other（不是 none）', () => {
  assert.equal(detectGpuVendor('Mystery Graphics 9000'), 'other');
  assert.equal(detectGpuVendor(''), 'none');
  assert.equal(detectGpuVendor(null), 'none');
});

test('Adreno 集成顯卡不被視為 Ollama 加速器', () => {
  assert.equal(isAcceleratorVendor('qualcomm'), false);
  assert.equal(isAcceleratorVendor('nvidia'), true);
  assert.equal(isAcceleratorVendor('amd'), true);
});

test('多張顯卡：優先取有獨立顯存者，而不是集成顯卡', () => {
  const hw = parseHardware({ totalMemoryBytes: 32 * GB, freeDiskBytes: 100 * GB, gpus: [ADRENO, { name: 'NVIDIA GeForce RTX 4060', adapterRamBytes: 8 * GB }] });
  assert.equal(hw.gpuVendor, 'nvidia');
  assert.equal(hw.vramGB, 8);
  assert.equal(hw.gpuMemoryShared, false);
});

test('32 GB 配 Adreno：不啟用雙模型，理由說明實際顯卡與 CPU 執行', () => {
  const plan = planLocalAI({ ramGB: 32, freeDiskGB: 100, vramGB: 0, gpuVendor: 'qualcomm', gpuName: ADRENO.name, gpuMemoryShared: true });
  assert.equal(plan.tier, 'heavy');
  assert.equal(plan.installBoth, false);
  const reason = plan.reasons.join('｜');
  assert.match(reason, /Adreno/);
  assert.match(reason, /CPU/);
});

test('32 GB 配 NVIDIA 8 GB：雙模型', () => {
  const plan = planLocalAI({ ramGB: 32, freeDiskGB: 100, vramGB: 8, gpuVendor: 'nvidia', gpuName: 'RTX', gpuMemoryShared: false }, BUILTIN_RULES);
  assert.equal(plan.installBoth, true);
});
