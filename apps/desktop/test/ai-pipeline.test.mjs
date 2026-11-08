// AI 流程測試：用真實司法院資料，透過 AI 完成逐案分析、綜合分析、單一判決精讀，並匯出檔案讀回檢查。
// 需要環境變數 JUDGE_TEST_AI_KEY（OpenAI 相容服務的金鑰）；沒有設定時整組略過。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { callAi } from '../dist/main/ai.js';
const require = createRequire(import.meta.url);
const core = require('@judge/core');
const { buildScopeWorkbook, buildScopeDocx } = require('../dist/main/scopeExporters.js');
const { buildBriefDocx } = require('../dist/main/exporters.js');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');

const KEY = process.env.JUDGE_TEST_AI_KEY;
const cfg = { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: process.env.JUDGE_TEST_AI_MODEL ?? 'gpt-4o-mini', apiKey: KEY };
const ai = (system, user, maxTokens) => callAi(cfg, { system, user, maxTokens });

test('AI 流程：篩選 → 逐案分析 → 綜合分析 → 匯出 Excel／Word', { skip: !KEY && '未設定 JUDGE_TEST_AI_KEY', timeout: 900000 }, async () => {
  const rows = await core.buildScopeTable({ statute: '二二八事件處理及補償條例', maxItems: 2 });
  assert.ok(rows.length > 0, '應找到引用該法規的判決');
  const analyses = [];
  for (const r of rows) {
    const d = await core.getJudgmentDetail(r.id);
    const a = await core.analyzeCase(ai, '二二八事件處理及補償條例', r, d);
    assert.ok(a.issue && a.holding, `逐案分析應有爭點與見解：${r.title}`);
    analyses.push(a);
  }
  const synthesis = await core.synthesizeScope(ai, '二二八事件處理及補償條例', analyses);
  assert.ok(synthesis.overview && synthesis.conclusion, '綜合分析應有概述與結論');
  const sheets = [{ statute: '二二八事件處理及補償條例', rows, analyses, synthesis }];

  const xlsx = await buildScopeWorkbook(sheets, {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx);
  const ws = wb.getWorksheet('二二八事件處理及補償條例');
  assert.equal(ws.getRow(1).getCell(7).value, '爭點（AI）');
  assert.ok(String(ws.getRow(2).getCell(7).value).length > 0, 'Excel 的爭點欄應有 AI 內容');

  const docx = await buildScopeDocx(sheets, {});
  const xml = new AdmZip(docx).readAsText('word/document.xml');
  assert.ok(xml.includes('綜合分析') && xml.includes('逐案分析'));
  assert.ok(xml.includes(synthesis.conclusion.slice(0, 8)), 'Word 應包含 AI 的研究結論');
  console.log('逐案分析：', analyses.map((a) => `${a.group}｜${a.outcome}`).join(' / '));
});

test('AI 流程：單一判決精讀由 AI 產生完整結構並匯出 Word', { skip: !KEY && '未設定 JUDGE_TEST_AI_KEY', timeout: 900000 }, async () => {
  const items = await core.searchJudgments('戒嚴', { maxItems: 3 });
  const d = await core.getJudgmentDetail(items[0].id);
  const doc = await core.briefJudgment(ai, d, { focus: '', length: '約 1 頁' });
  assert.ok(doc.sections.length >= 4, 'AI 應產生多個段落');
  const docx = await buildBriefDocx(d, doc);
  const xml = new AdmZip(docx).readAsText('word/document.xml');
  assert.ok(xml.includes(doc.sections[0].heading));
  assert.ok(xml.includes('原判決主文'));
});
