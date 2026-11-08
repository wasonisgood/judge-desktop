// 法規網路層的實際連線測試（需要網路；平常不在發版流程中執行）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LawClient, periodReport, currentArticleText, createCurlFetch } from '../dist/index.js';
const curl = createCurlFetch();

test('live: 全國法規資料庫以法名查到 pcode，並取得現行條文', { timeout: 120000 }, async () => {
  const c = new LawClient({ fetchImpl: curl });
  const s = await c.searchMojByName('國家賠償法');
  assert.ok(s.exact, '應找到完全相同的法名');
  const law = await c.fetchCurrentLaw(s.exact.pcode);
  assert.ok(law.articles.length >= 10, '條文應至少 10 條');
  assert.match(currentArticleText(law, '2') ?? '', /公務員/);
});

test('live: 立法院法條沿革取得歷次修法版本，並可做期間比對', { timeout: 120000 }, async () => {
  const c = new LawClient({ fetchImpl: curl });
  const { history, historyUrl } = await c.fetchLawHistory('國家賠償法');
  assert.match(historyUrl, /^https:\/\/lis\.ly\.gov\.tw\//);
  assert.ok(history.length >= 10, '沿革應至少 10 條');
  const a2 = history.find((h) => h.article === '2');
  assert.ok(a2 && a2.versions.length >= 1);
  const r = periodReport(a2, { from: '1900-01-01', to: '2100-01-01' });
  assert.ok(r.versionsInPeriod.length >= 1);
});
