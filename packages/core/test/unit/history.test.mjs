// 法條沿革（立法院）解析與期間異動比對測試。
// 樣本：國家賠償法沿革頁（test/fixtures/lis_history_nca.html）；期間比對另用合成資料，方便檢查每種情況。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLawHistoryHtml, parseRocDateLabel, periodReport, versionInForce } from '../../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'fixtures', 'lis_history_nca.html'), 'utf8');
const hist = parseLawHistoryHtml(html);
const art = (no) => hist.find((a) => a.article === no);

test('民國日期標籤轉西元：制定、修正', () => {
  assert.deepEqual(parseRocDateLabel('(0690620 制定)'), { date: '1980-06-20', kind: '制定' });
  assert.deepEqual(parseRocDateLabel('(1100113 修正)'), { date: '2021-01-13', kind: '修正' });
  assert.deepEqual(parseRocDateLabel('(無日期)'), { date: null, kind: '無日期' });
});

test('沿革：每條都有條號與版本，條號標準化', () => {
  assert.ok(hist.length >= 15, `條數應至少 15，實際 ${hist.length}`);
  assert.ok(art('1'), '應有第 1 條');
  assert.ok(art('2'), '應有第 2 條');
  assert.equal(art('1').noText, '第一條');
  for (const a of hist) assert.ok(a.versions.length >= 1, `${a.article} 應至少有一個版本`);
});

test('沿革：第 1 條的制定日期與條文', () => {
  const v = art('1').versions[0];
  assert.equal(v.date, '1980-06-20');
  assert.equal(v.kind, '制定');
  assert.match(v.text, /依中華民國憲法第二十四條制定之/);
  assert.match(v.reason, /制定本法之依據/);
});

test('沿革：條文內的段落（項）以換行分開', () => {
  const v = art('2').versions[0];
  const lines = v.text.split('\n');
  assert.ok(lines.length >= 3, `第 2 條應有至少三行（三項），實際 ${lines.length}`);
  assert.match(lines[0], /^本法所稱公務員者/);
  assert.match(lines[2], /前項情形/);
});

test('沿革：版本依日期由舊到新', () => {
  for (const a of hist) {
    const dates = a.versions.map((v) => v.date ?? '');
    const sorted = [...dates].sort();
    assert.deepEqual(dates, sorted, `${a.article} 版本應依日期排序`);
  }
});

// ---- 期間異動比對（合成資料，便於檢查每一種情況）----
const synthetic = {
  article: '99',
  noText: '第九十九條',
  versions: [
    { date: '2000-01-01', kind: '制定', text: '甲項文字\n一、款甲\n二、款乙', reason: '' },
    { date: '2010-06-01', kind: '修正', text: '甲項文字\n一、款甲改寫\n二、款乙', reason: '' },
    { date: '2020-06-01', kind: '修正', text: '甲項文字\n一、款甲改寫\n二、款乙', reason: '' },
    { date: '2024-01-01', kind: '修正', text: '甲項文字改寫\n一、款甲改寫\n二、款乙', reason: '' },
  ],
};

test('期間內：基準版本是期間開始日當時生效的版本', () => {
  assert.equal(versionInForce(synthetic.versions, '2015-01-01').date, '2010-06-01');
  assert.equal(versionInForce(synthetic.versions, '1999-01-01'), null);
});

test('期間比對：整條比較，有任何修法就算異動', () => {
  const r = periodReport(synthetic, { from: '2005-01-01', to: '2015-12-31' });
  assert.equal(r.baseline.date, '2000-01-01');
  assert.equal(r.changed, true);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].version.date, '2010-06-01');
});

test('期間比對：指定某一款，其他項改了也不算此款異動', () => {
  // 第 2 款（二、款乙）從未改動；第 1 項在 2024 年才改。期間只到 2015 年 → 不應有異動。
  const r = periodReport(synthetic, { from: '2005-01-01', to: '2015-12-31', paragraph: 1, item: 2 });
  assert.equal(r.changed, false);
  assert.equal(r.endText, '二、款乙');
});

test('期間比對：指定某一款，只在該款改動時才算異動（精確到款）', () => {
  const r = periodReport(synthetic, { from: '2005-01-01', to: '2015-12-31', paragraph: 1, item: 1 });
  assert.equal(r.changed, true);
  assert.equal(r.changes[0].before, '一、款甲');
  assert.equal(r.changes[0].after, '一、款甲改寫');
  assert.deepEqual(r.changes[0].added, ['一、款甲改寫']);
  assert.deepEqual(r.changes[0].removed, ['一、款甲']);
});

test('期間比對：指定某一項，項的文字改動才算異動', () => {
  const inPeriod = periodReport(synthetic, { from: '2021-01-01', to: '2025-01-01', paragraph: 1 });
  assert.equal(inPeriod.changed, true, '2024 年第 1 項文字改寫，應偵測到');
  const before = periodReport(synthetic, { from: '2021-01-01', to: '2023-12-31', paragraph: 1 });
  assert.equal(before.changed, false, '2024 年才改，期間到 2023 年不應有異動');
});

test('期間比對：沒有指定期間時，比對全部版本', () => {
  const r = periodReport(synthetic, {});
  assert.equal(r.baseline, null);
  assert.equal(r.versionsInPeriod.length, 4);
  assert.equal(r.changes.length, 2, "2010 年與 2020 年文字相同，只有 2010、2024 兩次異動");
});

test('期間比對：不存在的款，回傳 null 而不是拋錯', () => {
  const r = periodReport(synthetic, { from: '2005-01-01', to: '2025-01-01', paragraph: 1, item: 9 });
  assert.equal(r.endText, null);
  assert.equal(r.changed, false);
});
