// 段落檢索（issue #10 桌面端）的純函式測試：篩選、候選取得、AI 排序回退、引文丟棄、同案合併、取消。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { filterSummaries, normalizeFilter, runSemanticSearch, SEMANTIC_MAX_CANDIDATES } = require('../dist/main/services/semanticService.js');

const summary = (id, title, dateIso) => ({ id, title, dateDisplay: '', dateIso, cause: '', href: `https://example.test/${id}` });

const detailOf = (id, caseNo, sections) => ({
  meta: { id, title: `臺灣臺北地方法院 ${caseNo}刑事判決`, court: '臺灣臺北地方法院', caseNo, judgmentType: '判決', dateMinguo: '', dateIso: '2025-03-01', cause: '詐欺', sourceUrl: `https://example.test/${id}` },
  sections,
  history: [],
  historyPosition: null,
  printHistoryUrl: null,
  pdfUrl: null,
  relatedLaws: [],
  fullText: Object.values(sections).join('\n'),
});

const FACT_A = '被告於民國110年間冒充檢察官，要求被害人匯款至指定帳戶，致被害人陷於錯誤而匯款新臺幣十萬元。';
const OPIN_A = '本院認被告犯後態度良好，得依刑法第59條酌減其刑。';
const FACT_B = '被告另以假投資名義詐騙他人，取得款項後將款項轉入人頭帳戶。';

function fakeDetails(map) {
  return async (id) => {
    if (!map[id]) throw new Error(`查無 ${id}`);
    return map[id];
  };
}

const signal = () => new AbortController().signal;

test('篩選：法院層級依標題判斷，案件類型與年份區間同時生效', () => {
  const items = [
    summary('a', '臺灣高等法院 110 年度上訴字第 1 號刑事判決', '2021-05-01'),
    summary('b', '臺灣臺北地方法院 111 年度訴字第 2 號民事判決', '2022-05-01'),
    summary('c', '最高法院 112 年度台上字第 3 號刑事判決', '2023-05-01'),
    summary('d', '臺灣臺中地方法院 105 年度易字第 4 號刑事判決', '2016-05-01'),
    summary('e', '臺灣臺北地方法院 113 年度簡字第 5 號刑事判決', null),
  ];
  const ids = (f) => filterSummaries(items, normalizeFilter(f)).map((x) => x.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd', 'e'], '未設定條件時不篩除');
  assert.deepEqual(ids({ courtLevel: 'district' }), ['b', 'd', 'e']);
  assert.deepEqual(ids({ courtLevel: 'supreme' }), ['c']);
  assert.deepEqual(ids({ caseType: 'criminal' }), ['a', 'c', 'd', 'e']);
  assert.deepEqual(ids({ caseType: 'civil', courtLevel: 'district' }), ['b']);
  assert.deepEqual(ids({ yearFrom: 2020, yearTo: 2022 }), ['a', 'b', 'e'], '沒有日期的筆數不因年份被排除');
});

test('篩選條件正規化：未知值回到預設，年份非法時忽略', () => {
  const f = normalizeFilter({ courtLevel: 'bogus', caseType: 'x', yearFrom: Number.NaN, yearTo: 99999 });
  assert.deepEqual(f, { courtLevel: 'all', caseType: 'all', yearFrom: undefined, yearTo: undefined });
});

test('AI 排序：只採信逐字存在於判決的引文，同案段落合併；兩種排序皆可用', async () => {
  const details = fakeDetails({
    A: detailOf('A', '110年度上訴字第1號', { '犯罪事實': FACT_A, '理由': OPIN_A }),
    B: detailOf('B', '111年度訴字第2號', { '犯罪事實': FACT_B }),
  });
  const ai = async () => JSON.stringify({
    ranked: [
      { n: 1, score: 0.9, quote: '冒充檢察官，要求被害人匯款至指定帳戶', basis: '相同手法' },
      { n: 2, score: 0.4, quote: '這句話不在判決原文中', basis: '捏造' },
      { n: 2, score: 0.6, quote: '取得款項後將款項轉入人頭帳戶', basis: '洗錢' },
    ],
  });
  const r = await runSemanticSearch(
    { keyword: '冒充檢察官', query: '冒充檢察官要求匯款', kind: 'fact', filter: normalizeFilter({}), maxCandidates: 10 },
    { search: async () => [summary('A', '臺灣高等法院 110 年度上訴字第 1 號刑事判決', '2025-03-01'), summary('B', '臺灣臺北地方法院 111 年度訴字第 2 號刑事判決', '2025-04-01')], detail: details, ai, signal: signal() },
  );
  assert.equal(r.scoreSource, 'ai');
  assert.equal(r.notice, null);
  assert.equal(r.hits.length, 2, '捏造引文的那一筆被丟棄');
  assert.equal(r.discarded, 1);
  assert.equal(r.hits[0].caseId, 'A');
  assert.equal(r.hits[0].kind, 'fact');
  assert.equal(r.hits[0].passageText, FACT_A, '段落原文逐字來自判決');
  assert.ok(r.hits.every((h) => h.kind === 'fact'), '事實模式不含見解段落');
  assert.equal(r.bySimilarity[0].caseId, 'A');
  assert.equal(r.byCaseNo[0].caseId, 'A', '案號排序（110 在 111 之前）');
  assert.equal(r.sources.A.court, '臺灣臺北地方法院', '來源含法院與連結');
  assert.equal(r.sources.A.href, 'https://example.test/A');
});

test('同一案號的多個段落合併為同一組', async () => {
  const details = fakeDetails({ A: detailOf('A', '110年度上訴字第1號', { '理由': OPIN_A + '\n另外法院認為此一情節亦應審酌。' }) });
  const ai = async () => JSON.stringify({
    ranked: [
      { n: 1, score: 0.8, quote: '得依刑法第59條酌減其刑', basis: 'x' },
      { n: 2, score: 0.5, quote: '此一情節亦應審酌', basis: 'y' },
    ],
  });
  const r = await runSemanticSearch(
    { keyword: '刑法第59條', query: '酌減其刑', kind: 'opinion', filter: normalizeFilter({}), maxCandidates: 5 },
    { search: async () => [summary('A', '臺灣高等法院 110 年度上訴字第 1 號刑事判決', null)], detail: details, ai, signal: signal() },
  );
  assert.equal(r.hits.length, 2, '同一判決的兩個見解段落都保留');
  assert.ok(r.hits.every((h) => h.kind === 'opinion'));
  assert.equal(r.bySimilarity.length, 1, '同一案號只出現一組');
  assert.equal(r.bySimilarity[0].hits.length, 2);
  assert.equal(r.bySimilarity[0].best, 0.8);
});

test('AI 失敗時回退為關鍵字排序，並明確標示非語意', async () => {
  const details = fakeDetails({ A: detailOf('A', '110年度上訴字第1號', { '犯罪事實': FACT_A }) });
  const ai = async () => { throw new Error('服務暫時無法使用'); };
  const r = await runSemanticSearch(
    { keyword: '匯款', query: '冒充檢察官匯款', kind: 'fact', filter: normalizeFilter({}), maxCandidates: 5 },
    { search: async () => [summary('A', '臺灣高等法院 110 年度上訴字第 1 號刑事判決', null)], detail: details, ai, signal: signal() },
  );
  assert.equal(r.scoreSource, 'keyword');
  assert.match(r.notice, /非語意/);
  assert.ok(r.hits.length >= 1, '回退仍有結果');
  assert.ok(r.hits.every((h) => h.basis.includes('非語意')));
});

test('沒有 AI 時回退並沿用原因說明', async () => {
  const details = fakeDetails({ A: detailOf('A', '110年度上訴字第1號', { '犯罪事實': FACT_A }) });
  const r = await runSemanticSearch(
    { keyword: '匯款', query: '冒充檢察官', kind: 'fact', filter: normalizeFilter({}), maxCandidates: 5 },
    { search: async () => [summary('A', '臺灣高等法院 110 年度上訴字第 1 號刑事判決', null)], detail: details, aiError: '尚未設定 AI 金鑰', signal: signal() },
  );
  assert.equal(r.scoreSource, 'keyword');
  assert.match(r.notice, /尚未設定 AI 金鑰.*非語意/);
});

test('單筆內文讀取失敗只記錄，其餘照常排序', async () => {
  const details = fakeDetails({ B: detailOf('B', '111年度訴字第2號', { '犯罪事實': FACT_B }) });
  const ai = async () => JSON.stringify({ ranked: [{ n: 1, score: 0.7, quote: '取得款項後將款項轉入人頭帳戶', basis: 'x' }] });
  const r = await runSemanticSearch(
    { keyword: '詐欺', query: '人頭帳戶', kind: 'fact', filter: normalizeFilter({}), maxCandidates: 5 },
    { search: async () => [summary('A', '臺灣高等法院 110 年度上訴字第 1 號刑事判決', null), summary('B', '臺灣臺北地方法院 111 年度訴字第 2 號刑事判決', null)], detail: details, ai, signal: signal() },
  );
  assert.equal(r.fetched, 1);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /^A：/);
  assert.equal(r.hits[0].caseId, 'B');
});

test('候選上限為 500 筆，篩選後才截斷', async () => {
  const many = Array.from({ length: 600 }, (_, i) => summary(`X${i}`, '臺灣臺北地方法院 110 年度訴字第 1 號刑事判決', null));
  let asked = 0;
  const r = await runSemanticSearch(
    { keyword: 'x', query: 'x', kind: 'fact', filter: normalizeFilter({}), maxCandidates: 9999 },
    { search: async (_k, max) => { asked = max; return many.slice(0, max); }, detail: async () => { throw new Error('略過'); }, signal: signal() },
  );
  assert.equal(asked, SEMANTIC_MAX_CANDIDATES);
  assert.equal(r.considered, SEMANTIC_MAX_CANDIDATES);
  assert.equal(r.notes.length, SEMANTIC_MAX_CANDIDATES);
});

test('取消後不送出 AI 排序，回傳已取消', async () => {
  const ctrl = new AbortController();
  const details = fakeDetails({ A: detailOf('A', '110年度上訴字第1號', { '犯罪事實': FACT_A }) });
  let aiCalled = false;
  const r = await runSemanticSearch(
    { keyword: '匯款', query: '冒充檢察官', kind: 'fact', filter: normalizeFilter({}), maxCandidates: 5 },
    {
      search: async () => [summary('A', '臺灣高等法院 110 年度上訴字第 1 號刑事判決', null)],
      detail: async (id) => { ctrl.abort(); return details(id); },
      ai: async () => { aiCalled = true; return '{}'; },
      signal: ctrl.signal,
    },
  );
  assert.equal(r.cancelled, true);
  assert.equal(aiCalled, false);
  assert.equal(r.hits.length, 0);
});
