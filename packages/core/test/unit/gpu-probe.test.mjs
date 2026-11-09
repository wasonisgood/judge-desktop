// 顯卡偵測與方案：lspci、nvidia-smi、system_profiler 的解析；Apple Silicon 視為加速；AMD 選 ROCm 資產。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLspciGpus, parseNvidiaSmi, parseSystemProfilerGpus, parseHardware, planLocalAI, BUILTIN_RULES, ollamaAssetFor,
} from '../../dist/index.js';

test('lspci：取出顯示控制器的廠商與型號', () => {
  const out = [
    '00:02.0 "VGA compatible controller" "Intel Corporation" "UHD Graphics 620" -r07 "Dell" "Device 0868"',
    '01:00.0 "3D controller" "NVIDIA Corporation" "GP107M [GeForce GTX 1050 Mobile]" -ra1',
    '00:1f.3 "Audio device" "Intel Corporation" "Cannon Lake PCH cAVS"',
  ].join('\n');
  const gpus = parseLspciGpus(out);
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].name, 'Intel Corporation UHD Graphics 620');
  assert.match(gpus[1].name, /NVIDIA/);
});

test('nvidia-smi：名稱與顯存（MiB）換算為位元組', () => {
  const gpus = parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288\n');
  assert.equal(gpus[0].name, 'NVIDIA GeForce RTX 3060');
  assert.equal(gpus[0].adapterRamBytes, 12288 * 1024 * 1024);
});

test('system_profiler：Apple GPU 名稱；缺少顯存時記為 0（統一記憶體）', () => {
  const json = JSON.stringify({ SPDisplaysDataType: [{ _name: 'Apple M2', sppci_model: 'Apple M2' }] });
  const gpus = parseSystemProfilerGpus(json);
  assert.deepEqual(gpus, [{ name: 'Apple M2', adapterRamBytes: 0 }]);
  assert.deepEqual(parseSystemProfilerGpus('not json'), []);
});

test('顯卡判定：Apple Silicon 的 GPU 廠商為 apple', () => {
  const hw = parseHardware({ totalMemoryBytes: 32 * 1024 ** 3, freeDiskBytes: 200 * 1024 ** 3, gpus: [{ name: 'Apple M2', adapterRamBytes: 0 }] });
  assert.equal(hw.gpuVendor, 'apple');
});

test('方案：Apple Silicon 以統一記憶體加速，32 GB 時可安裝雙模型', () => {
  const hw = parseHardware({ totalMemoryBytes: 64 * 1024 ** 3, freeDiskBytes: 300 * 1024 ** 3, gpus: [{ name: 'Apple M3 Max', adapterRamBytes: 0 }] });
  const plan = planLocalAI(hw, BUILTIN_RULES);
  assert.equal(plan.tier, 'heavy');
  assert.equal(plan.installBoth, true);
});

test('方案：沒有獨立顯卡的 Linux（只有集成顯卡）不加速，維持原本只安裝精讀模型', () => {
  const hw = parseHardware({ totalMemoryBytes: 64 * 1024 ** 3, freeDiskBytes: 300 * 1024 ** 3, gpus: [{ name: 'Intel Corporation UHD Graphics 620', adapterRamBytes: 0 }] });
  const plan = planLocalAI(hw, BUILTIN_RULES);
  assert.equal(plan.tier, 'heavy');
  assert.equal(plan.installBoth, false);
});

test('資產：Linux 在 AMD 加速時使用 ROCm 版本，其餘維持基本版', () => {
  assert.equal(ollamaAssetFor('x64', 'linux', 'amd'), 'ollama-linux-amd64-rocm.tar.zst');
  assert.equal(ollamaAssetFor('x64', 'linux', 'nvidia'), 'ollama-linux-amd64.tar.zst');
  assert.equal(ollamaAssetFor('x64', 'linux'), 'ollama-linux-amd64.tar.zst');
});
