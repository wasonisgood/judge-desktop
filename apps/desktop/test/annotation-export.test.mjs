// 個案研究筆記 Word 匯出測試：螢光以字元底色（w:shd）保留，註解附在段落後，需重新對位的註解另列。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildAnnotatedDocx, HIGHLIGHT_FILL } = require('../dist/main/exporters.js');
const AdmZip = require('adm-zip');

const FULL = '主文：上訴駁回。\n事實：被告於民國一一〇年三月間持刀威脅告訴人。\n理由：被告所辯不足採。';
const meta = { title: '測試案', caseNo: '110年度上訴字第1號', court: '臺灣高等法院', dateIso: '2021-03-01', cause: '恐嚇', sourceUrl: 'https://example.test/x' };

function ann(id, start, end, color, mode, note = '') {
  return {
    id, judgmentId: 'J1', start, end, quote: FULL.slice(start, end), textHash: 'h', color, mode, note,
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
  const buf = await buildAnnotatedDocx({ meta, fullText: FULL }, annotations, []);
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.ok(xml.includes('w:shd'), '應含字元底色');
  assert.ok(xml.includes(`w:fill="${HIGHLIGHT_FILL.pink}"`), '粉紅螢光應以底色輸出');
  assert.ok(xml.includes(`w:fill="${HIGHLIGHT_FILL.blue}"`), '藍色螢光應以底色輸出');
  assert.ok(xml.includes('威脅要件之認定'), '註解文字應出現在文件中');
  assert.ok(xml.includes('持刀'), '標注的原文應保留');
  // 註解段落位於其標注所在段（事實段）之後，而不是文件最前面。
  assert.ok(xml.indexOf('威脅要件之認定') > xml.indexOf('持刀'));
});

test('僅只畫螢光的標注不產生註解段落；需重新對位的註解另列於最後', async () => {
  const s = FULL.indexOf('持刀');
  const stale = [{ ...ann('s1', 0, 3, 'green', 'highlight_note', '舊版位置的註解'), status: 'needs_reanchor' }];
  const buf = await buildAnnotatedDocx({ meta, fullText: FULL }, [ann('a1', s, s + 2, 'yellow', 'highlight')], stale);
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.ok(xml.includes(`w:fill="${HIGHLIGHT_FILL.yellow}"`));
  assert.ok(!xml.includes('註解（事實）：'), '只畫螢光的標注不應產生註解段落');
  assert.ok(xml.includes('需重新對位的註解'), '應有需重新對位的區段');
  assert.ok(xml.includes('舊版位置的註解'), '需重新對位的註解仍應保留在匯出檔');
});

test('沒有標注的全文匯出仍是有效的 Word 文件', async () => {
  const buf = await buildAnnotatedDocx({ meta, fullText: FULL }, []);
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  assert.ok(xml.includes('判決全文'));
  assert.ok(xml.includes('被告所辯不足採'));
  assert.equal(xml.split('w:fill="FFF176"').length - 1, 1, '只有顏色說明使用該底色，全文沒有標注');
});
