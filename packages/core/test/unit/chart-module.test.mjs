// 量化圖表模組（chart）的模組登錄與安裝流程：與既有模組互不影響，安裝／停用／移除的狀態可判讀。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModuleRegistry, MODULE_IDS, isModuleReady, installChartModule, CHART_STAGES } from '../../dist/index.js';

test('MODULE_IDS 含 chart，且初始狀態為未安裝', () => {
  assert.ok(MODULE_IDS.includes('chart'));
  const j = new ModuleRegistry().toJSON();
  assert.equal(j.chart.status, 'not-installed');
  assert.equal(j.chart.installedVersion, null);
});

test('更新 chart 不會改動 ai-engine 與 crawler 的狀態（獨立）', () => {
  const r = new ModuleRegistry();
  r.set('ai-engine', { installedVersion: '1.0.0', status: 'ready' });
  r.set('crawler', { installedVersion: '1.0.0', status: 'failed', lastError: 'x', failedStage: 'smokeFetch' });
  const ai = r.get('ai-engine');
  const cr = r.get('crawler');
  r.set('chart', { installedVersion: '1.0.0', status: 'ready' });
  assert.deepEqual(r.get('ai-engine'), ai);
  assert.deepEqual(r.get('crawler'), cr);
  assert.equal(r.get('chart').status, 'ready');
});

test('舊的登錄檔（沒有 chart 欄位）載入後 chart 為未安裝', () => {
  const r = new ModuleRegistry({ 'ai-engine': { installedVersion: '1.0.0', status: 'ready' } });
  assert.equal(r.get('chart').status, 'not-installed');
  assert.equal(r.get('ai-engine').status, 'ready');
});

test('isModuleReady：只有 ready 可用；停用、未安裝、安裝中、失敗都不可用', () => {
  assert.equal(isModuleReady({ status: 'ready' }), true);
  for (const status of ['not-installed', 'installing', 'failed', 'disabled']) {
    assert.equal(isModuleReady({ status }), false, status);
  }
  assert.equal(isModuleReady(undefined), false);
  assert.equal(isModuleReady(null), false);
});

test('installChartModule：三個階段全部通過 → ok 且 register 被呼叫', async () => {
  let registered = false;
  const res = await installChartModule({
    checkBundle: () => {},
    selfCheck: () => {},
    register: () => { registered = true; },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.completed, [...CHART_STAGES]);
  assert.equal(registered, true);
});

test('installChartModule：自我檢查失敗 → 停在 selfCheck，不註冊', async () => {
  let registered = false;
  const res = await installChartModule({
    checkBundle: () => {},
    selfCheck: () => { throw new Error('計算結果不符'); },
    register: () => { registered = true; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.failedAt, 'selfCheck');
  assert.deepEqual(res.completed, ['checkBundle']);
  assert.equal(registered, false);
  assert.match(res.error, /計算結果不符/);
});

test('installChartModule：內建檔案缺失 → 停在 checkBundle（非同步錯誤也會被捕捉）', async () => {
  let registered = false;
  const res = await installChartModule({
    checkBundle: async () => { throw new Error('找不到內建模組'); },
    selfCheck: () => {},
    register: () => { registered = true; },
  });
  assert.equal(res.failedAt, 'checkBundle');
  assert.equal(registered, false);
});
