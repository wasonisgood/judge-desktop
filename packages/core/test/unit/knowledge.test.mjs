// 爭點知識庫單元測試（issue #5）：驗證、Router、重新檢索上限、上下文字數上限，以及讀入真實內容檔。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateIssue, validateKnowledgeFile, buildKnowledgeIndex, routeIssues, rerouteIssues,
  buildKnowledgeContext, diceSimilarity, MAX_ROUTE_ATTEMPTS,
} from '../../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', '..', '..', '..', 'knowledge', 'data');

const sampleIssue = (over = {}) => ({
  id: 'tw-crim-test-001', title: '正當防衛', path: ['刑法', '刑法總則', '違法性', '正當防衛'],
  keywords: ['正當防衛', '現在不法侵害', '防衛過當'], proposition: '防衛行為是否須具必要性',
  distinction: '採必要性說與相當性說的結論不同', doctrines: [
    { label: '甲說', view: 'A', pros: 'p', cons: 'c' }, { label: '乙說', view: 'B', pros: 'p', cons: 'c' },
  ], practice: [{ period: '近期', view: 'V', note: '' }], lawRefs: ['刑法第 23 條'], reviewStatus: 'ai-draft-unverified',
  ...over,
});
const fileOf = (issues) => ({ schemaVersion: 1, jurisdiction: 'TW', domain: '刑法總則', issues });

test('validateIssue：完整爭點通過；缺學說、學說不足兩說、缺 id 都會被擋', () => {
  assert.deepEqual(validateIssue(sampleIssue()), []);
  assert.ok(validateIssue(sampleIssue({ doctrines: [{ label: '甲說', view: 'A', pros: 'p', cons: 'c' }] })).length > 0);
  assert.ok(validateIssue(sampleIssue({ id: '' })).length > 0);
  assert.ok(validateIssue(sampleIssue({ practice: [] })).length > 0);
});

test('validateKnowledgeFile：壞掉的爭點被略過並記錄，其他爭點仍保留；重複 id 只留第一筆', () => {
  const raw = fileOf([sampleIssue(), sampleIssue({ id: 'bad', doctrines: [] }), sampleIssue()]);
  const v = validateKnowledgeFile(raw, 'x.json');
  assert.equal(v.issues.length, 1);
  assert.ok(v.problems.some((p) => p.issueId === 'bad'));
  assert.ok(v.problems.some((p) => /重複/.test(p.message)));
});

test('validateKnowledgeFile：schemaVersion 不符整檔拒絕', () => {
  const v = validateKnowledgeFile({ ...fileOf([sampleIssue()]), schemaVersion: 2 }, 'x.json');
  assert.equal(v.file, null);
  assert.equal(v.issues.length, 0);
});

test('Router：關鍵詞精確命中排在前面；領域過濾生效；低相關結果不回傳', () => {
  const { index } = buildKnowledgeIndex([{ source: 'a', raw: fileOf([sampleIssue(), sampleIssue({ id: 'tw-crim-test-002', title: '未遂犯', keywords: ['未遂', '著手', '實行'], domain: 'x' })]) }]);
  const r = routeIssues(index, { query: '防衛行為遇到現在不法侵害' });
  assert.equal(r.hits[0].issue.id, 'tw-crim-test-001');
  assert.ok(r.hits[0].reasons.some((x) => x.includes('關鍵詞命中')));
  assert.equal(routeIssues(index, { query: '公司法股東會' }).hits.length, 0);
  assert.equal(routeIssues(index, { query: '正當防衛', domain: '不存在的領域' }).hits.length, 0);
});

test('模糊搜尋：錯字或近似說法仍能命中（Dice 相似度）', () => {
  assert.ok(diceSimilarity('正當防禦', '正當防衛') > 0.5);
  const { index } = buildKnowledgeIndex([{ source: 'a', raw: fileOf([sampleIssue()]) }]);
  assert.equal(routeIssues(index, { query: '正當防禦的現在不法侵害' }).hits.length, 1);
});

test('重新檢索：排除前次給過的爭點，且總次數上限為 MAX_ROUTE_ATTEMPTS', () => {
  const { index } = buildKnowledgeIndex([{ source: 'a', raw: fileOf([sampleIssue(), sampleIssue({ id: 'tw-crim-test-003', title: '正當防衛二' })]) }]);
  const first = routeIssues(index, { query: '正當防衛' });
  const ids = first.hits.map((h) => h.issue.id);
  const again = rerouteIssues(index, { query: '正當防衛', previousIds: ids, previousAttempt: first.attempt });
  assert.equal(again.ok, true);
  assert.equal(again.result.attempt, 2);
  assert.ok(again.result.hits.every((h) => !ids.includes(h.issue.id)));
  const over = rerouteIssues(index, { query: 'x', previousIds: [], previousAttempt: MAX_ROUTE_ATTEMPTS });
  assert.equal(over.ok, false);
});

test('上下文組裝：超過字數上限時略過後續爭點並記錄，不超出上限', () => {
  const { index } = buildKnowledgeIndex([{ source: 'a', raw: fileOf([sampleIssue(), sampleIssue({ id: 'tw-crim-test-004', title: '第二' })]) }]);
  const r = routeIssues(index, { query: '正當防衛' });
  const ctx = buildKnowledgeContext(r.hits, 300);
  assert.ok(ctx.text.length <= 301);
  assert.ok(ctx.usedIds.length >= 1);
  const big = buildKnowledgeContext(r.hits, 100000);
  assert.equal(big.usedIds.length, r.hits.length);
});

test('真實內容檔：knowledge/data 下所有 JSON 都能通過驗證，且 id 不重複', () => {
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  const sources = files.map((f) => ({ source: f, raw: JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')) }));
  const built = buildKnowledgeIndex(sources);
  const bad = built.problems.filter((p) => !/重複/.test(p.message));
  assert.deepEqual(bad, [], '不應有驗證錯誤');
  assert.ok(built.index.issues.length >= 900);
});
