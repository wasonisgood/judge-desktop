// 生命週期冒煙測試（v3.6.0 G1）：有背景工作時關閉主視窗 → 視窗隱藏、程式仍在、工作完成後才結束。
// 執行：npx electron scripts/ui-smoke-lifecycle.cjs   （需先 npm run build；JUDGE_SKIP_AUTH=1）
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

require('../dist/main/main.js');
const jobs = require('../dist/main/services/jobRegistry.js');

async function waitWindow() {
  for (let i = 0; i < 100; i++) {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.webContents.isLoading()) return w;
    await wait(100);
  }
  throw new Error('視窗沒有載入');
}

let reported = false;
function report(exitCode) {
  if (reported) return;
  reported = true;
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` — ${r.detail}`}`);
  console.log(`
${results.length - failed.length}/${results.length} 通過`);
  process.exitCode = exitCode ?? (failed.length ? 1 : 0);
}
// 程式結束前輸出結果（工作完成後程式會自行結束，不能等到最後才輸出）。
app.on('will-quit', () => {
  check('工作完成後程式結束（will-quit）', true);
  report(0);
});

app.whenReady().then(async () => {
  let w;
  try {
    w = await waitWindow();
    await wait(500);

    // 以一個長任務模擬「搜尋／範圍仍在進行」
    let finishJob;
    const done = new Promise((r) => { finishJob = r; });
    const running = jobs.withJob('smoke-lifecycle', 'scope', '生命週期測試任務', () => done);
    await wait(100);
    check('工作已登記為執行中', jobs.runningCount() === 1);

    // 關閉主視窗：應被攔下（隱藏），程式仍在
    w.close();
    await wait(400);
    check('有工作時關閉視窗：視窗隱藏而非銷毀', !w.isDestroyed() && !w.isVisible(), `destroyed=${w.isDestroyed()} visible=${w.isVisible()}`);
    check('有工作時程式仍在執行', BrowserWindow.getAllWindows().length >= 1);

    // 工作完成 → 程式應結束
    finishJob('ok');
    await running;
    await wait(1500);
  } catch (err) {
    check('執行過程沒有例外', false, err instanceof Error ? err.stack : String(err));
  } finally {
    // 不主動結束程式：必須由生命週期自行結束（工作完成後）才算通過；8 秒內沒有結束則判定失敗。
    setTimeout(() => {
      check('工作完成後程式自行結束', false, '逾時仍未結束');
      report(1);
      app.exit(1);
    }, 8000).unref();
  }
});
