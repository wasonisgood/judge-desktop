// 標編碼標注工序的處理流程說明：每一句都來自實際的流程紀錄（只用法規、只用關鍵字、相關法規篩選、AI 失敗回退）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrace, addStep, explainScopeTrace, explainTrace } from '../../dist/index.js';

const step = (trace, s) => addStep(trace, { module: 'rule', decision: 'pass', reason: '', input: '', output: '', ...s });

test('只用法規：說明法名確認、篩選輪次、逐案編碼、依據驗證與待覆核，並帶入實際數字', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: 'AI 分析設定', input: '啟用', output: '逐案編碼（分類、爭點）與綜合分析、自動調整搜尋用語皆啟用', reason: '使用者啟用 AI 分析' });
  step(t, { stage: '確認法名', input: '國家賠償法', output: '國家賠償法', reason: '法名確認完成' });
  step(t, { stage: '第 1 輪篩選判決', input: '國家賠償法', output: '「國家賠償法」3 筆；累計保留 3 筆', decision: 'pass', reason: '已有可用結果，放行生成' });
  step(t, { stage: '整理篩選結果', input: '國家賠償法（第2條）', output: '3 筆', reason: '只保留判決中確實引用該法規的案件' });
  step(t, { stage: 'AI 逐案編碼', module: 'cloud', input: '3 筆判決，2 個欄位', output: '成功 3 筆，失敗 0 筆，待覆核 1 格' });
  step(t, { stage: '依據逐字驗證', module: 'rule', input: '6 則依據', output: '通過 5 則，移除 1 則', reason: '依據必須逐字出現在 AI 看過的原文中' });
  step(t, { stage: '待覆核標示', module: 'rule', input: '6 格', output: '1 格待覆核', reason: '內容未取得或依據不全' });
  const e = explainScopeTrace(t, { sheets: 1, rows: 3, pending: 1 });
  assert.equal(e.title, '標編碼標注工序：處理流程說明');
  const text = e.paragraphs.join('\n');
  assert.match(text, /法規確認：「國家賠償法」對應「國家賠償法」/);
  assert.match(text, /第 1 輪篩選判決：以「國家賠償法」搜尋，「國家賠償法」3 筆；累計保留 3 筆。/);
  assert.match(text, /AI 逐案編碼（3 筆判決，2 個欄位）：成功 3 筆，失敗 0 筆，待覆核 1 格。/);
  assert.match(text, /依據驗證：通過 5 則，移除 1 則（依據必須逐字出現在 AI 看過的原文中）。/);
  assert.match(text, /待覆核：1 格待覆核（內容未取得或依據不全）。/);
  assert.doesNotMatch(text, /關鍵字/, '只用法規時不應出現關鍵字');
  assert.equal(e.paragraphs.at(-1), '結果：1 組，共 3 筆，其中 1 格待覆核。');
});

test('只用關鍵字：來源是關鍵字，不做法名確認，搜尋結果全部列出', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: 'AI 分析設定', input: '關閉', output: '只做傳統篩選', reason: '使用者關閉 AI 分析或沒有可用的 AI' });
  step(t, { stage: '第 1 輪篩選判決', input: '戒嚴 賠償', output: '「戒嚴 賠償」12 筆；累計保留 12 筆', decision: 'pass', reason: '已有可用結果，放行生成' });
  step(t, { stage: '整理篩選結果', input: '關鍵字：戒嚴 賠償', output: '12 筆', reason: '關鍵字搜尋結果全部列出（不以法規篩選）' });
  const text = explainScopeTrace(t).paragraphs.join('\n');
  assert.match(text, /第 1 輪篩選判決：以「戒嚴 賠償」搜尋，「戒嚴 賠償」12 筆；累計保留 12 筆。/);
  assert.match(text, /篩選結果：12 筆（關鍵字搜尋結果全部列出（不以法規篩選））。/);
  assert.doesNotMatch(text, /法規確認/);
  assert.doesNotMatch(text, /AI 逐案編碼/, '關閉 AI 時不應出現編碼段落');
});

test('相關法規篩選：說明相關法規的上下文，以及篩選前後的筆數', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: '讀入法規現行條文與沿革', input: '國家賠償法', output: '已讀入', reason: '法規內容已交給 AI 提議關鍵字' });
  step(t, { stage: '第 1 輪篩選判決', input: '戒嚴 賠償', output: '「戒嚴 賠償」10 筆；累計保留 10 筆', decision: 'pass', reason: '已有可用結果，放行生成' });
  step(t, { stage: '相關法規篩選', input: '10 筆', output: '4 筆', reason: '只保留引用「國家賠償法」的判決' });
  step(t, { stage: '整理篩選結果', input: '關鍵字：戒嚴 賠償（相關法規：國家賠償法）', output: '4 筆', reason: '只保留引用「國家賠償法」的判決' });
  const text = explainScopeTrace(t).paragraphs.join('\n');
  assert.match(text, /相關法規「國家賠償法」的現行條文與沿革：已讀入，提供 AI 提議關鍵字時參考。/);
  assert.match(text, /相關法規篩選：10 筆 → 4 筆（只保留引用「國家賠償法」的判決）。/);
});

test('AI 失敗回退：提議關鍵字失敗與逐案失敗都說明清楚，並以目前結果輸出', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: '第 1 輪篩選判決', input: '戒嚴', output: '「戒嚴」2 筆；累計保留 2 筆', decision: 'retry', reason: '結果不足，改用提議的關鍵字再查' });
  step(t, { stage: '提議新關鍵字', input: '已嘗試：戒嚴', output: '失敗', decision: 'capped', reason: 'AI 服務回傳 401' });
  step(t, { stage: 'AI 逐案編碼', module: 'cloud', input: '2 筆判決，1 個欄位', output: '成功 1 筆，失敗 1 筆' });
  step(t, { stage: 'AI 綜合分析', module: 'cloud', input: '1 則逐案分析', output: '失敗', decision: 'skip', reason: '金鑰失效' });
  const e = explainScopeTrace(t, { sheets: 1, rows: 2, pending: 0 });
  const text = e.paragraphs.join('\n');
  assert.match(text, /AI 無法提議新的關鍵字（AI 服務回傳 401），改以目前已找到的結果輸出。/);
  assert.match(text, /AI 逐案編碼（2 筆判決，1 個欄位）：成功 1 筆，失敗 1 筆。/);
  assert.match(text, /綜合分析失敗（金鑰失效），只保留逐案編碼結果。/);
  assert.match(text, /第 1 輪篩選判決：以「戒嚴」搜尋，「戒嚴」2 筆；累計保留 2 筆；結果不足，改用 AI 提議的關鍵字再查。/);
  assert.equal(e.paragraphs.at(-1), '結果：1 組，共 2 筆。');
});

test('AI 沒有新的關鍵字可試時，明確說明已以目前結果輸出', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: '提議新關鍵字', input: '已嘗試：戒嚴', output: '沒有新的關鍵字可以嘗試', decision: 'capped', reason: '提議的關鍵字都已嘗試過' });
  assert.match(explainScopeTrace(t).paragraphs[0], /AI 沒有提議新的關鍵字，改以目前結果輸出。/);
});

test('語意不清與使用者取消也會寫進說明', () => {
  const t = newTrace('標編碼標注工序');
  step(t, { stage: '語意確認', input: '已嘗試：無', output: '您指的是刑事還是民事？', decision: 'ask', reason: '使用者需求語意不清' });
  step(t, { stage: '取消', module: 'user', input: '使用者要求取消', output: '保留 0 組的已完成部分', decision: 'stop' });
  const text = explainScopeTrace(t).paragraphs.join('\n');
  assert.match(text, /AI 判定需求語意不清，請使用者選擇：您指的是刑事還是民事？。/);
  assert.match(text, /使用者取消：保留 0 組的已完成部分。/);
});

test('沒有任何步驟時沿用通用說明', () => {
  const e = explainScopeTrace(newTrace('標編碼標注工序'));
  assert.deepEqual(e.paragraphs, explainTrace(newTrace('標編碼標注工序')).paragraphs);
});
