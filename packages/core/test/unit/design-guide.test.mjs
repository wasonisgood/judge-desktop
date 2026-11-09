// 研究設計引導（issue #11）測試：追問順序、建議附理由且不自動套用、可實證性檢查、摘要與範圍參數對應。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStep, suggestNarrowing, feasibilityChecks, applySuggestion, newSession, answerSlot, addGuideTurn, acceptSuggestion,
  buildDesignSummary, summaryToScopeOptions, designSummaryText, SLOT_ORDER,
} from '../../dist/index.js';

const NOW = new Date('2026-11-10T00:00:00Z');

test('追問順序：先問研究問題，全部齊備後回傳 null', () => {
  let s = newSession('我想研究消費者訴訟', NOW);
  assert.equal(nextStep(s.slots).slot, 'question');
  s = answerSlot(s, 'question', '消費者訴訟中，原告有律師代理是否較容易勝訴？', NOW);
  assert.equal(nextStep(s.slots).slot, 'subject');
  const asked = [];
  for (let guard = 0; guard < 20; guard++) {
    const n = nextStep(s.slots);
    if (!n) break;
    asked.push(n.slot);
    s = answerSlot(s, n.slot, n.slot === 'yearFrom' ? '2018 至 2023' : `回答-${n.slot}`, NOW);
  }
  assert.deepEqual(asked, ['subject', 'variable', 'yearFrom', 'statute', 'caseType', 'courtLevel']);
  assert.equal(nextStep(s.slots), null);
  assert.equal(s.slots.yearFrom, 2018);
  assert.equal(s.slots.yearTo, 2023);
});

test('每一步都附理由（研究方法語言）', () => {
  const step = nextStep({ problem: 'x' });
  assert.match(step.rationale, /研究問題/);
});

test('年份解析：需要西元年，否則拒絕', () => {
  const s = newSession('x', NOW);
  assert.throws(() => answerSlot(s, 'yearFrom', '去年', NOW), /西元年/);
});

test('建議只回傳選項，不改動欄位；接受後才套用並留存紀錄', () => {
  let s = newSession('問題', NOW);
  s = answerSlot(s, 'question', '消費者訴訟中律師代理的效果如何？', NOW);
  s = answerSlot(s, 'yearFrom', '2010 至 2024', NOW);
  const suggestions = suggestNarrowing(s.slots);
  const period = suggestions.find((x) => x.dimension === 'period');
  assert.ok(period, '期間超過五年時建議縮小期間');
  assert.match(period.rationale, /可比性/);
  assert.match(period.tradeoff, /樣本/);
  assert.equal(s.slots.yearFrom, 2010, '未接受前不得改動期間');
  const after = acceptSuggestion(s, period, NOW);
  assert.equal(after.slots.yearFrom, period.patch.yearFrom);
  assert.equal(after.accepted.length, 1);
  assert.equal(s.accepted.length, 0, '原物件不被修改');
});

test('可實證性檢查：未定義的項目為 fail；期間超過今年為 fail；只有一年為 warn', () => {
  const empty = feasibilityChecks({ problem: '' }, NOW);
  assert.ok(empty.some((c) => c.key === 'question' && c.status === 'fail'));
  assert.ok(empty.some((c) => c.key === 'period' && c.status === 'fail'));
  const future = feasibilityChecks({ problem: 'x', question: '這是一個完整的研究問題？', subject: 's', variable: 'v', yearFrom: 2025, yearTo: 2027 }, NOW);
  assert.match(future.find((c) => c.key === 'period').message, /尚無判決書/);
  const oneYear = feasibilityChecks({ problem: 'x', question: '這是一個完整的研究問題？', subject: 's', variable: 'v', yearFrom: 2024, yearTo: 2024 }, NOW);
  assert.equal(oneYear.find((c) => c.key === 'period').status, 'warn');
});

test('限定條件時提示選擇偏誤；未指定法規時提示需逐案確認相關性', () => {
  const narrowed = feasibilityChecks({ problem: 'x', courtLevel: '地方法院' }, NOW);
  assert.equal(narrowed.find((c) => c.key === 'selectionBias').status, 'warn');
  const noStatute = feasibilityChecks({ problem: 'x' }, NOW);
  assert.equal(noStatute.find((c) => c.key === 'statute').status, 'warn');
});

test('摘要：缺漏會寫進限制；人工篩選條件獨立列出；每步理由保留', () => {
  let s = newSession('問題', NOW);
  s = answerSlot(s, 'question', '消費者訴訟中律師代理的效果如何？', NOW);
  s = addGuideTurn(s, '請確認期間', '期間決定樣本量', NOW);
  s = answerSlot(s, 'caseType', '民事', NOW);
  const sum = buildDesignSummary(s);
  assert.ok(sum.limitations.some((l) => l.includes('尚未決定：研究對象')));
  assert.deepEqual(sum.manualFilters, ['案件類型：民事']);
  assert.equal(sum.rationales.length, 1);
  const text = designSummaryText(sum);
  assert.match(text, /研究問題：消費者訴訟中律師代理的效果如何？/);
  assert.match(text, /需人工篩選：案件類型：民事/);
});

test('摘要帶入範圍整理：需要法規才能帶入；只帶可自動套用的條件', () => {
  assert.equal(summaryToScopeOptions({ problem: 'x' }), null);
  const opts = summaryToScopeOptions({ problem: 'x', question: '律師代理的效果？', statute: '消費者保護法', yearFrom: 2018, yearTo: 2023, caseType: '民事' });
  assert.deepEqual(opts, { statute: '消費者保護法', yearFrom: 2018, yearTo: 2023, searchQuery: '律師代理的效果？' });
});

test('助理不會自動改動篩選條件：建議的 patch 只在 acceptSuggestion 時寫入', () => {
  let s = newSession('問題', NOW);
  s = answerSlot(s, 'question', '消費者訴訟中律師代理的效果如何？', NOW);
  const court = suggestNarrowing(s.slots).find((x) => x.dimension === 'court');
  assert.equal(s.slots.courtLevel, undefined);
  const applied = applySuggestion(s.slots, court);
  assert.equal(applied.courtLevel, '地方法院');
  assert.equal(s.slots.courtLevel, undefined);
});
