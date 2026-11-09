// 個案研究筆記 Word 匯出測試：螢光以字元底色（w:shd）保留，註解附在段落後，需重新對位的註解另列；
// 多案合併：每案獨立區塊（分頁）、各自保留螢光與註解；自訂顏色名稱同時用於說明與註解。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildAnnotatedDocx, buildAnnotatedCasesDocx, HIGHLIGHT_FILL } = require('../dist/main/exporters.js');
const AdmZip = require('adm-zip');

const FULL = '主文：上訴駁回。\n事實：被告於民國一一〇年三月間持刀威脅告訴人。\n理由：被告所辯不足採。';
const meta = { title: '測試案', caseNo: '110年度上訴字第1號', court: '臺灣高等法院', dateIso: '2021-03-01', cause: '恐嚇', sourceUrl: 'https://example.test/x' };
const DEFAULTS = { yellow: '事實', green: '爭點', pink: '主文', blue: '理由' };

function ann(id, start, end, color, mode, note = '', fullText = FULL) {
  return {
    id, judgmentId: 'J1', start, end, quote: fullText.slice(start, end), textHash: 'h', color, mode, note,
    origin: 'manual', createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  };
}

test('單案筆記 Word：螢光以 w:shd 底色保留，註解文字附在段落後', async () => {
  const s = FULL.indexOf('持刀');
  const r = FULL.indexOf('所辯不足採');
  const annotations = [
    ann('a1', s, s + 2, 'pink', 'highlight_note', '威脅要件之認定'),
    ann('a2', r, r + 5, 'blue', 'highlight'),
  ];
  const buf = await buildAnnotatedDocx({ meta, fullText: FULL, annotations, stale: [] });
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.ok(xml.includes('w:shd'), '應含字元底色');
  assert.ok(xml.includes(`w:fill="${HIGHLIGHT_FILL.pink}"`), '粉紅螢光應以底色輸出');
  assert.ok(xml.includes(`w:fill="${HIGHLIGHT_FILL.blue}"`), '藍色螢光應以底色輸出');
  assert.ok(xml.includes('威脅要件之認定'), '註解文字應出現在文件中');
  assert.ok(xml.includes('持刀'), '標注的原文應保留');
  assert.ok(xml.indexOf('威脅要件之認定') > xml.indexOf('持刀'), '註解位於其標注所在段之後');
});

test('僅只畫螢光的標注不產生註解段落；需重新對位的註解另列於最後', async () => {
  const s = FULL.indexOf('持刀');
  const stale = [ann('s1', 0, 3, 'green', 'highlight_note', '舊版位置的註解')];
  const buf = await buildAnnotatedDocx({ meta, fullText: FULL, annotations: [ann('a1', s, s + 2, 'yellow', 'highlight')], stale });
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.ok(xml.includes(`w:fill="${HIGHLIGHT_FILL.yellow}"`));
  assert.ok(!xml.includes('註解（事實）：'), '只畫螢光的標注不應產生註解段落');
  assert.ok(xml.includes('需重新對位的註解'), '應有需重新對位的區段');
  assert.ok(xml.includes('舊版位置的註解'), '需重新對位的註解仍應保留在匯出檔');
});

test('沒有標注的全文匯出仍是有效的 Word 文件', async () => {
  const buf = await buildAnnotatedDocx({ meta, fullText: FULL, annotations: [] });
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.ok(xml.includes('判決全文'));
  assert.ok(xml.includes('被告所辯不足採'));
  assert.equal(xml.split('w:fill="FFF176"').length - 1, 1, '只有顏色說明使用該底色，全文沒有標注');
});

test('自訂顏色名稱同時用於顏色說明與註解標題', async () => {
  const s = FULL.indexOf('持刀');
  const labels = { ...DEFAULTS, pink: '暴力要件' };
  const a = ann('a1', s, s + 2, 'pink', 'highlight_note', '註解內容');
  const buf = await buildAnnotatedDocx({ meta, fullText: FULL, annotations: [a] }, labels);
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.ok(xml.includes('暴力要件'), '顏色說明應使用自訂名稱');
  assert.ok(xml.includes('註解（暴力要件）：'), '註解標題應使用自訂名稱');
  assert.ok(!xml.includes('註解（主文）：'), '不應殘留預設名稱');
});

test('多案合併：每案一個區塊（案名各出現一次、分頁 N-1 次），各自保留螢光與註解', async () => {
  const FULL2 = '主文：撤銷原判決。\n理由：被告之上訴有理由，發回更審。';
  const s1 = FULL.indexOf('持刀');
  const s2 = FULL2.indexOf('上訴有理由');
  const cases = [
    { meta: { ...meta, title: '案件甲' }, fullText: FULL, annotations: [ann('a1', s1, s1 + 2, 'pink', 'highlight_note', '甲案註解')] },
    { meta: { ...meta, title: '案件乙', caseNo: '111年度上易字第2號' }, fullText: FULL2,
      annotations: [ann('b1', s2, s2 + 5, 'green', 'highlight_note', '乙案註解', FULL2)],
      stale: [ann('b2', 0, 2, 'blue', 'highlight_note', '乙案舊註解', FULL2)] },
  ];
  const buf = await buildAnnotatedCasesDocx(cases, DEFAULTS);
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.equal(xml.split('案件甲').length - 1, 1, '案件甲標題一次');
  assert.equal(xml.split('案件乙').length - 1, 1, '案件乙標題一次');
  assert.equal((xml.match(/w:pageBreakBefore/g) || []).length, 1, '兩案之間分頁一次');
  assert.ok(xml.includes('甲案註解') && xml.includes('乙案註解'), '兩案的註解都保留');
  assert.ok(xml.includes(`w:fill="${HIGHLIGHT_FILL.pink}"`) && xml.includes(`w:fill="${HIGHLIGHT_FILL.green}"`), '兩案的螢光都保留');
  assert.ok(xml.includes('乙案舊註解'), '需重新對位的註解也保留');
  assert.ok(xml.indexOf('甲案註解') < xml.indexOf('案件乙'), '依傳入順序排列');
});

test('多案合併沒有案件時拋錯', async () => {
  await assert.rejects(buildAnnotatedCasesDocx([]), /沒有可匯出的案件/);
});
