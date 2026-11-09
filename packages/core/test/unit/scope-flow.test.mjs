// 標編碼標注工序的流程狀態與按鈕前置條件：沒有輸入、只有法規、只有關鍵字、執行中、完成、失敗回退。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrace, addStep, scopeFlowNodes, scopeControlStates, scopeNodeForStage, scopeNodeForPhase, scopeInputValid, applicableNodes } from '../../dist/index.js';

const base = { statutes: [], keyword: '', relatedStatute: '', relatedOnly: false, smart: false, aiOn: true, fieldCount: 5 };
const ctl = (over = {}) => ({ ...base, running: false, hasResult: false, hasExplanation: false, ...over });
const status = (nodes) => Object.fromEntries(nodes.map((n) => [n.id, n.status]));
const step = (trace, s) => addStep(trace, { module: 'rule', decision: 'pass', reason: '', input: '', output: '', ...s });

test('沒有輸入：來源未完成，按鈕停用並說明原因', () => {
  assert.equal(scopeInputValid(base), false);
  assert.equal(scopeInputValid({ ...base, statutes: ['  '], keyword: '  ' }), false);
  const g = scopeControlStates(ctl());
  assert.equal(g.run.enabled, false);
  assert.equal(g.run.reason, '請先輸入關鍵字，或至少一部法規');
  assert.equal(g.exportFile.enabled, false);
  assert.equal(g.explain.enabled, false);
  assert.equal(g.explain.reason, '尚未執行，沒有處理流程可以查看');
  assert.equal(g.smart.enabled, false);
  assert.equal(g.cancel.enabled, false);
  const nodes = scopeFlowNodes(base);
  assert.equal(nodes.find((n) => n.id === 'input').status, 'pending');
  assert.equal(nodes.find((n) => n.id === 'lookup').status, 'skipped', '沒有法規就不做法名確認');
  assert.equal(nodes.find((n) => n.id === 'search').status, 'pending');
});

test('只有法規：法名確認適用，關鍵字相關的智慧搜尋停用，可以開始', () => {
  const i = { ...base, statutes: ['國家賠償法'] };
  const g = scopeControlStates(ctl(i));
  assert.equal(g.run.enabled, true);
  assert.equal(g.smart.enabled, false, '智慧搜尋需要關鍵字');
  assert.equal(g.smart.reason, '智慧搜尋需要先輸入關鍵字');
  const s = status(scopeFlowNodes(i));
  assert.equal(s.lookup, 'pending');
  assert.equal(s.input, 'done');
});

test('只有關鍵字：不做法名確認，智慧搜尋可用，只保留相關法規需要相關法規', () => {
  const i = { ...base, keyword: '戒嚴 賠償' };
  const g = scopeControlStates(ctl({ ...i, relatedOnly: true }));
  assert.equal(g.run.enabled, false);
  assert.match(g.run.reason, /相關法規/);
  assert.equal(scopeControlStates(ctl(i)).smart.enabled, true);
  assert.equal(scopeControlStates(ctl(i)).run.enabled, true);
  assert.equal(status(scopeFlowNodes(i)).lookup, 'skipped');
});

test('AI 關閉或沒有欄位：編碼與驗證略過，沒有欄位時不能開始', () => {
  const noFields = scopeControlStates(ctl({ ...base, keyword: 'x', fieldCount: 0 }));
  assert.equal(noFields.run.enabled, false);
  assert.match(noFields.run.reason, /分析欄位/);
  const off = status(scopeFlowNodes({ ...base, keyword: 'x', aiOn: false }));
  assert.equal(off.coding, 'skipped');
  assert.equal(off.verify, 'skipped');
  assert.equal(off.synthesis, 'skipped');
  assert.equal(applicableNodes({ ...base, keyword: 'x' }).has('coding'), true);
});

test('執行中：目前階段進行中，之前完成、之後未開始；按鈕與欄位停用，取消可用', () => {
  const i = { ...base, keyword: '戒嚴' };
  const s = status(scopeFlowNodes(i, { running: '篩選判決' }));
  assert.equal(s.search, 'running');
  assert.equal(s.input, 'done');
  assert.equal(s.coding, 'pending');
  const coding = status(scopeFlowNodes(i, { running: 'AI 逐案編碼' }));
  assert.equal(coding.search, 'done');
  assert.equal(coding.coding, 'running');
  assert.equal(coding.synthesis, 'pending');
  const g = scopeControlStates(ctl({ ...i, running: true }));
  assert.equal(g.run.enabled, false);
  assert.match(g.run.reason, /整理進行中/);
  assert.equal(g.cancel.enabled, true);
  assert.equal(g.input.enabled, false);
  assert.equal(g.explain.enabled, true, '執行中可以看即時流程');
  assert.equal(g.exportFile.enabled, false);
});

test('完成：每個節點依紀錄顯示完成，並附上該節點的說明句', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: 'AI 分析設定', input: '啟用', output: '逐案編碼（分類）與綜合分析、自動調整搜尋用語皆啟用' });
  step(t, { stage: '第 1 輪篩選判決', input: '戒嚴', output: '「戒嚴」3 筆；累計保留 3 筆', decision: 'pass' });
  step(t, { stage: '整理篩選結果', input: '關鍵字：戒嚴', output: '3 筆', reason: '關鍵字搜尋結果全部列出' });
  step(t, { stage: 'AI 逐案編碼', module: 'cloud', input: '3 筆判決，1 個欄位', output: '成功 3 筆，失敗 0 筆，待覆核 0 格' });
  step(t, { stage: '依據逐字驗證', input: '3 則依據', output: '通過 3 則，移除 0 則' });
  step(t, { stage: 'AI 綜合分析', module: 'cloud', input: '3 則逐案分析', output: '完成' });
  const i = { ...base, keyword: '戒嚴' };
  const nodes = scopeFlowNodes(i, { trace: t });
  const s = status(nodes);
  assert.equal(s.search, 'done');
  assert.equal(s.coding, 'done');
  assert.equal(s.verify, 'done');
  assert.equal(s.synthesis, 'done');
  assert.equal(s.lookup, 'skipped');
  assert.equal(s.filter, 'done');
  assert.match(nodes.find((n) => n.id === 'coding').lines[0], /AI 逐案編碼（3 筆判決，1 個欄位）：成功 3 筆/);
  const g = scopeControlStates(ctl({ ...i, hasResult: true, hasExplanation: true }));
  assert.equal(g.exportFile.enabled, true);
  assert.equal(g.explain.enabled, true);
  assert.equal(g.run.enabled, true);
});

test('失敗回退：提議關鍵字失敗與綜合分析失敗標示為失敗，流程仍完成並保留結果', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: '第 1 輪篩選判決', input: '戒嚴', output: '「戒嚴」2 筆；累計保留 2 筆', decision: 'retry' });
  step(t, { stage: '提議新關鍵字', input: '已嘗試：戒嚴', output: '失敗', decision: 'capped', reason: 'AI 服務回傳 401' });
  step(t, { stage: 'AI 逐案編碼', module: 'cloud', input: '2 筆判決，1 個欄位', output: '成功 2 筆，失敗 0 筆，待覆核 0 格' });
  step(t, { stage: 'AI 綜合分析', module: 'cloud', input: '2 則逐案分析', output: '失敗', decision: 'skip', reason: '金鑰失效' });
  const nodes = scopeFlowNodes({ ...base, keyword: '戒嚴' }, { trace: t });
  const s = status(nodes);
  assert.equal(s.search, 'failed', '搜尋節點標示失敗（已回退）');
  assert.equal(s.synthesis, 'failed');
  assert.equal(s.coding, 'done', '逐案編碼成功不因綜合失敗而改變');
  assert.match(nodes.find((n) => n.id === 'search').lines[1], /AI 無法提議新的關鍵字（AI 服務回傳 401）/);
  assert.equal(scopeControlStates(ctl({ ...base, keyword: '戒嚴', hasResult: true })).exportFile.enabled, true, '失敗回退後仍可匯出結果');
});

test('全部案件編碼失敗時，編碼節點標示失敗', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: 'AI 逐案編碼', module: 'cloud', input: '2 筆判決，1 個欄位', output: '成功 0 筆，失敗 2 筆，待覆核 0 格' });
  assert.equal(status(scopeFlowNodes({ ...base, keyword: 'x' }, { trace: t })).coding, 'failed');
});

test('語意不清時搜尋節點等待選擇，之後流程停止', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: '語意確認', input: '已嘗試：無', output: '您指的是哪一種？', decision: 'ask' });
  assert.equal(status(scopeFlowNodes({ ...base, keyword: '無' }, { trace: t })).search, 'waiting');
});

test('階段與進度名稱對應到正確的流程節點', () => {
  assert.equal(scopeNodeForStage('第 3 輪篩選判決'), 'search');
  assert.equal(scopeNodeForStage('相關法規篩選'), 'filter');
  assert.equal(scopeNodeForStage('不存在的階段'), null);
  assert.equal(scopeNodeForPhase('確認法名與法條沿革'), 'lookup');
  assert.equal(scopeNodeForPhase('AI 逐案編碼'), 'coding');
  assert.equal(scopeNodeForPhase('其他'), null);
});

test('執行中但紀錄只寫到一半：已寫入的步驟立即顯示說明句，目前階段進行中，之後的未開始', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: 'AI 分析設定', input: '啟用', output: '逐案編碼（分類）與綜合分析、自動調整搜尋用語皆啟用' });
  step(t, { stage: '第 1 輪篩選判決', input: '戒嚴', output: '「戒嚴」3 筆；累計保留 3 筆', decision: 'pass' });
  step(t, { stage: '整理篩選結果', input: '關鍵字：戒嚴', output: '3 筆', reason: '關鍵字搜尋結果全部列出' });
  const nodes = scopeFlowNodes({ ...base, keyword: '戒嚴' }, { trace: t, running: 'AI 逐案編碼' });
  const s = status(nodes);
  assert.equal(s.input, 'done');
  assert.equal(s.search, 'done');
  assert.equal(s.filter, 'done');
  assert.equal(s.coding, 'running', '目前階段是編碼，即使還沒有編碼的紀錄');
  assert.equal(s.verify, 'pending');
  assert.equal(s.synthesis, 'pending');
  assert.equal(s.lookup, 'skipped', '不適用的節點維持略過');
  assert.match(nodes.find((n) => n.id === 'search').lines[0], /第 1 輪篩選判決/, '已寫入的步驟立即有說明句');
});

test('執行中的步驟即時寫入：目前階段的說明句隨紀錄增加', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: 'AI 分析設定', input: '啟用', output: '逐案編碼' });
  const before = scopeFlowNodes({ ...base, keyword: 'x' }, { trace: t, running: '篩選判決' }).find((n) => n.id === 'search');
  assert.equal(before.status, 'running');
  assert.equal(before.lines.length, 0);
  step(t, { stage: '第 1 輪篩選判決', input: 'x', output: '「x」1 筆；累計保留 1 筆', decision: 'pass' });
  const after = scopeFlowNodes({ ...base, keyword: 'x' }, { trace: t, running: '篩選判決' }).find((n) => n.id === 'search');
  assert.equal(after.lines.length, 1);
  assert.match(after.lines[0], /第 1 輪篩選判決：以「x」搜尋/);
});
