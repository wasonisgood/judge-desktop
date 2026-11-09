// 文本擷取的批次執行：單筆失敗不中斷整批、取消後停止、警告不算失敗、輸出基底名稱、歷審表頭判斷，以及 crawl 工作互斥。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const runner = require('../dist/main/services/crawlRunner.js');
const jobs = require('../dist/main/services/jobRegistry.js');

const items = [
  { index: 1, title: 'A 字第 1 號', url: 'https://x/1' },
  { index: 2, title: 'B 字第 2 號', url: 'https://x/2' },
  { index: 3, title: 'C 字第 3 號', url: 'https://x/3' },
];
const describe = (it) => ({ index: it.index, title: it.title, url: it.url });

test('runItems：單筆失敗記錄原因，其餘照常處理', async () => {
  const ac = new AbortController();
  const log = await runner.runItems(items, {
    step: 'Step 2', signal: ac.signal, describe,
    run: async (it) => {
      if (it.index === 2) throw new Error('HTTP 503 https://x/2');
      return { file: `${it.index}.txt` };
    },
  });
  assert.equal(log.length, 3);
  assert.deepEqual(log.map((l) => l.ok), [true, false, true]);
  assert.equal(log[1].reason, 'HTTP 503 https://x/2');
  assert.equal(log[0].file, '1.txt');
  assert.equal(log[2].step, 'Step 2');
});

test('runItems：取消後不再處理後續各筆，回傳已完成的紀錄', async () => {
  const ac = new AbortController();
  const seen = [];
  const log = await runner.runItems(items, {
    step: 'Step 3', signal: ac.signal, describe,
    run: async (it) => {
      seen.push(it.index);
      if (it.index === 1) ac.abort();
      return undefined;
    },
  });
  assert.deepEqual(seen, [1]);
  assert.equal(log.length, 1);
  assert.equal(log[0].ok, true);
});

test('runItems：取消造成的例外不記為失敗', async () => {
  const ac = new AbortController();
  const log = await runner.runItems(items, {
    step: 'Step 2', signal: ac.signal, describe,
    run: async (it) => {
      if (it.index === 2) { ac.abort(); throw new Error('已取消'); }
      return undefined;
    },
  });
  assert.equal(log.length, 1);
  assert.equal(log[0].index, 1);
});

test('runItems：進度回報每處理一筆（含失敗）', async () => {
  const ac = new AbortController();
  const progress = [];
  await runner.runItems(items, {
    step: 'Step 2', signal: ac.signal, describe,
    run: async (it) => { if (it.index === 1) throw new Error('x'); },
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
});

test('warning：成功但有需提醒的事項（例如歷審列無法對應網址），結果仍為成功並寫明原因', async () => {
  const ac = new AbortController();
  const log = await runner.runItems(items.slice(0, 1), {
    step: 'Step 3', signal: ac.signal, describe,
    run: async () => ({ warning: '第 2 審無法對應網址' }),
  });
  assert.equal(log[0].ok, true);
  assert.equal(log[0].reason, '第 2 審無法對應網址');
});

test('outputBase：去掉副檔名；歷審清單再去掉「_歷審」', () => {
  assert.equal(runner.outputBase('C:\\data\\判決清單.xlsx'), '判決清單');
  assert.equal(runner.outputBase('/tmp/判決清單.csv'), '判決清單');
  assert.equal(runner.outputBase('/tmp/判決清單_歷審.xlsx', { stripHistorySuffix: true }), '判決清單');
  assert.equal(runner.outputBase('/tmp/判決清單_歷審.xlsx'), '判決清單_歷審');
});

test('歷審表頭與歷審序號', () => {
  assert.equal(runner.isHistoryHeader(['清單序號', '歷審', '法院', '案號', '裁判日期', '網址', '備註']), true);
  assert.equal(runner.isHistoryHeader(['Index', 'Title', 'URL']), false);
  assert.equal(runner.historySeqOf('歷審_2'), 2);
  assert.equal(runner.historySeqOf('歷審'), null);
});

test('crawl 工作：同時只能有一項，其他類別不受影響', async () => {
  const sig = jobs.beginJob('crawl-a', 'crawl', '文本擷取 Step 2');
  assert.throws(() => jobs.beginJob('crawl-b', 'crawl', '文本擷取 Step 3'), /已有「文本擷取 Step 2」進行中/);
  const other = jobs.beginJob('crawl-other', 'scope', '範圍整理');
  assert.equal(other.aborted, false);
  jobs.cancelJob('crawl-a');
  assert.equal(sig.aborted, true);
  jobs.finishJob('crawl-a', 'cancelled');
  jobs.finishJob('crawl-other', 'done');
  const again = jobs.beginJob('crawl-c', 'crawl', '文本擷取 Step 1');
  assert.equal(again.aborted, false);
  jobs.finishJob('crawl-c', 'done');
});
