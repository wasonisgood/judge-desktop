// 案件類型與判決字別：字號解析、字別重疊不猜、無法對應的字別標示 unknown，以及範圍整理依字號篩選。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseTypeOf, caseTypeLabel, matchCaseType, parseCaseNo, parseCaseTypeInput, buildScopeTable, CASE_TYPES } from '../../dist/index.js';

test('字號解析：標準化年度、字別與字號', () => {
  const p = parseCaseNo('臺灣高等法院 112 年上易字第 123 號刑事判決');
  assert.equal(p.zi, '上易');
  assert.equal(p.caseNo, '112年度上易字第123號');
  assert.equal(p.year, 112);
  assert.equal(p.no, 123);
  assert.equal(parseCaseNo('沒有字號的標題'), null);
  // 年度字樣可省略，字別中的空白會被去除
  assert.equal(parseCaseNo('113 年 重 訴 字第 5 號').zi, '重訴');
});

test('字號寫明類型用語時以它為準（by-suffix）', () => {
  const c = caseTypeOf('臺灣高等法院 112 年上易字第 123 號刑事判決');
  assert.equal(c.type, '刑事');
  assert.equal(c.status, 'by-suffix');
  assert.equal(caseTypeOf('臺北高等行政法院 111 年度訴字第 9 號行政訴訟判決').type, '行政');
  // 字別本身屬於多類（訴），但字號寫明民事，仍判定為民事
  assert.equal(caseTypeOf('臺灣臺北地方法院 113 年度訴字第 2 號民事判決').type, '民事');
});

test('字別只對應一種類型時採用（by-zi）', () => {
  assert.equal(caseTypeOf('113 年度消債更字第 5 號').type, '民事');
  assert.equal(caseTypeOf('113 年度重訴字第 5 號').status, 'ambiguous', '重訴 實際字號中見於刑事，不得單獨定為民事');
  assert.equal(caseTypeOf('113 年度易字第 1 號').type, '刑事');
  assert.equal(caseTypeOf('113 年度交易字第 1 號').type, '刑事');
  assert.equal(caseTypeOf('113 年度勞訴字第 1 號').status, 'by-zi');
});

test('字別重疊時不猜：訴、上、聲、抗、再都標示 ambiguous', () => {
  for (const zi of ['訴', '上', '聲', '抗', '再']) {
    const c = caseTypeOf(`112 年度${zi}字第 7 號`);
    assert.equal(c.type, null, `字別「${zi}」不得猜測類型`);
    assert.equal(c.status, 'ambiguous');
    assert.ok(c.candidates.length >= 2, `字別「${zi}」應列出多個候選`);
  }
  assert.deepEqual(caseTypeOf('112 年度再字第 7 號').candidates.sort(), ['民事', '行政']);
});

test('不屬於任何類型的字別標示 unknown，不猜', () => {
  const c = caseTypeOf('112 年度特字第 1 號');
  assert.equal(c.type, null);
  assert.equal(c.status, 'unknown');
  assert.equal(matchCaseType('112 年度特字第 1 號', '民事'), 'unknown', '無法判定不等於不符合，也不等於符合');
});

test('無法解析字號時 no-caseno', () => {
  assert.equal(caseTypeOf('').status, 'no-caseno');
  assert.equal(caseTypeOf(null).type, null);
});

test('matchCaseType：符合、不符合、無法判定三種結果分開', () => {
  assert.equal(matchCaseType('113 年度易字第 1 號', '刑事'), 'match');
  assert.equal(matchCaseType('113 年度易字第 1 號', '民事'), 'mismatch');
  assert.equal(matchCaseType('113 年度訴字第 1 號', '民事'), 'unknown');
});

// 以下字號取自 2026-11 司法院裁判書查詢的實際搜尋結果（標題原樣，含「年度 字 字第」之間的空白）。
test('實際字號：民事判決／裁定皆由類型用語判定（含字別與類型用語之間有空白）', () => {
  assert.equal(caseTypeOf('臺灣南投地方法院 115 年度 訴 字第 238 號民事裁定').type, '民事');
  assert.equal(caseTypeOf('臺灣臺中地方法院 115 年度 消債更 字第 643 號民事裁定').type, '民事');
  assert.equal(caseTypeOf('臺灣臺東地方法院 115 年度 護 字第 111 號民事裁定').type, '民事');
  assert.equal(caseTypeOf('臺灣臺北地方法院 115 年度 抗 字第 556 號民事裁定').type, '民事', '抗 單獨為重疊，但字號寫明民事');
  assert.equal(caseTypeOf('臺灣高等法院 115 年度 再易 字第 60 號民事判決').type, '民事');
  assert.equal(caseTypeOf('臺灣嘉義地方法院 114 年度 勞訴 字第 5 號民事判決').type, '民事');
});

test('實際字號：字號寫明刑事（含聲保、交簡、毒抗）', () => {
  assert.equal(caseTypeOf('臺灣桃園地方法院 115 年度 原交簡 字第 106 號刑事判決').type, '刑事');
  assert.equal(caseTypeOf('臺灣桃園地方法院 115 年度 聲保 字第 9 號刑事裁定').type, '刑事');
  assert.equal(caseTypeOf('福建高等法院金門分院 115 年度 毒抗 字第 6 號刑事裁定').type, '刑事');
});

test('實際字號：「上易」同時見於刑事與民事，字號寫明類型時以類型為準', () => {
  const c = caseTypeOf('臺灣高等法院 高雄分院 114 年度 上易 字第 291 號民事判決');
  assert.equal(c.type, '民事');
  assert.equal(c.status, 'by-suffix');
  assert.equal(caseTypeOf('臺灣高等法院 114 年度 上易 字第 9 號').status, 'ambiguous', '沒有類型用語時不得猜');
});

test('實際字號：行政法院的判決／裁定不寫類型用語，以法院名稱判定為行政（不是重疊）', () => {
  const c = caseTypeOf('臺中高等行政法院 高等庭 113 年度 訴 字第 102 號判決');
  assert.equal(c.type, '行政');
  assert.equal(c.status, 'by-court');
  assert.equal(caseTypeOf('臺北高等行政法院 高等庭 115 年度 高抗 字第 10 號裁定').type, '行政');
  assert.equal(caseTypeOf('臺中高等行政法院 地方庭 115 年度 交 字第 33 號判決').type, '行政', '交 在刑事與行政都見過，法院名稱為準');
});

test('結果表標籤：民事／刑事／行政／重疊／未知，與判定結果一致', () => {
  assert.equal(caseTypeLabel('臺灣臺東地方法院 115 年度 護 字第 111 號民事裁定'), '民事');
  assert.equal(caseTypeLabel('臺中高等行政法院 高等庭 113 年度 訴 字第 102 號判決'), '行政');
  assert.equal(caseTypeLabel('臺灣臺北地方法院 113 年度訴字第 2 號'), '重疊');
  assert.equal(caseTypeLabel('臺灣臺北地方法院 113 年度特字第 2 號'), '未知');
  assert.equal(caseTypeLabel('無字號'), '未知');
});

test('使用者輸入的案件類型：只接受唯一的類型用語', () => {
  assert.equal(parseCaseTypeInput('民事'), '民事');
  assert.equal(parseCaseTypeInput('刑事案件'), '刑事');
  assert.equal(parseCaseTypeInput('行政訴訟'), '行政');
  assert.equal(parseCaseTypeInput('民事或刑事'), null);
  assert.equal(parseCaseTypeInput(''), null);
  assert.equal(parseCaseTypeInput(undefined), null);
  assert.deepEqual([...CASE_TYPES], ['民事', '刑事', '行政']);
});

// ---- 範圍整理依字號篩選（以替身取代網路來源）----

function fixture(id, title) {
  return {
    meta: { id, title, court: '測試法院', caseNo: null, judgmentType: '判決', dateMinguo: '113.1.1', dateIso: '2024-01-01', cause: '測試', sourceUrl: `https://example.test/${id}` },
    sections: { 主文: '駁回。' },
    history: [],
    historyPosition: null,
    relatedLaws: ['消費者保護法第7條'],
    fullText: '原告依消費者保護法第7條請求。',
    pdfUrl: null,
  };
}

test('範圍整理：指定民事時，只保留字號判定為民事的判決；無法判定者排除並回報', async () => {
  const items = [
    { id: 'A', title: '臺北地院 113 年度重訴字第 1 號民事判決', dateIso: '2024-01-01', cause: '', dateDisplay: '', href: '' },
    { id: 'B', title: '臺北地院 113 年度易字第 2 號刑事判決', dateIso: '2024-01-01', cause: '', dateDisplay: '', href: '' },
    { id: 'C', title: '臺北地院 113 年度訴字第 3 號', dateIso: '2024-01-01', cause: '', dateDisplay: '', href: '' },
    { id: 'D', title: '臺北地院 113 年度特字第 4 號', dateIso: '2024-01-01', cause: '', dateDisplay: '', href: '' },
  ];
  const details = {};
  const detailCalls = [];
  for (const it of items) details[it.id] = fixture(it.id, it.title);
  const skipped = [];
  const rows = await buildScopeTable({
    statute: '消費者保護法',
    client: {},
    caseType: '民事',
    maxItems: 10,
    searchSource: async () => items,
    detailSource: async (id) => { detailCalls.push(id); return details[id]; },
    onCaseTypeSkip: (title, status) => skipped.push(status),
  });
  assert.deepEqual(rows.map((r) => r.id), ['A']);
  assert.equal(rows[0].caseTypeLabel, '民事', '納入的列要標示字號類型');
  // B 在列表字號即可判定為刑事（by-suffix，字號寫明刑事判決），不應取得內頁；C、D 無法判定，排除並回報。
  assert.deepEqual(detailCalls.sort(), ['A', 'C', 'D']);
  // B 於列表階段排除（by-suffix）；C 取得內頁後因字別重疊排除（ambiguous）；D 字別未知（unknown）。
  assert.deepEqual([...skipped].sort(), ['ambiguous', 'by-suffix', 'unknown']);
});

test('範圍整理：未指定案件類型時不篩選（既有行為不變）', async () => {
  const items = [
    { id: 'A', title: '臺北地院 113 年度易字第 2 號刑事判決', dateIso: '2024-01-01', cause: '', dateDisplay: '', href: '' },
    { id: 'B', title: '臺北地院 113 年度特字第 4 號', dateIso: '2024-01-01', cause: '', dateDisplay: '', href: '' },
  ];
  const rows = await buildScopeTable({
    statute: '消費者保護法',
    client: {},
    maxItems: 10,
    searchSource: async () => items,
    detailSource: async (id) => fixture(id, items.find((x) => x.id === id).title),
  });
  assert.deepEqual(rows.map((r) => r.id), ['A', 'B']);
});
