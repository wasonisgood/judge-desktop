// 法院管轄區接縫：預設管轄區為台灣司法院、註冊規則、範圍整理可指定其他管轄區（全程不連網）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JurisdictionRegistry, jurisdictionRegistry, taiwanJudicialYuan, DEFAULT_JURISDICTION_ID, buildScopeTable,
} from '../../dist/index.js';

const fakeDetail = (id, statute) => ({
  id,
  meta: { title: `判決 ${id}`, court: '測試法院', dateIso: '2024-01-02', cause: '測試', sourceUrl: `https://example.test/${id}` },
  relatedLaws: [statute],
  fullText: `依${statute}第3條規定`,
  sections: { 主文: '上訴駁回。' },
  historyPosition: { summary: '' },
});

test('預設管轄區為台灣司法院；未指定 id 時取得台灣（既有行為不變）', () => {
  assert.equal(DEFAULT_JURISDICTION_ID, 'tw-judicial-yuan');
  assert.equal(jurisdictionRegistry.get().id, 'tw-judicial-yuan');
  assert.equal(jurisdictionRegistry.get(undefined).country, 'TW');
  assert.equal(taiwanJudicialYuan.name, '司法院裁判書查詢系統');
});

test('未知的管轄區直接拋錯，不會默默改用台灣', () => {
  assert.throws(() => jurisdictionRegistry.get('xx-unknown'), /未知的管轄區：xx-unknown/);
});

test('重複註冊同一個 id 會拋錯，且不覆寫既有項目', () => {
  const r = new JurisdictionRegistry();
  r.register({ id: 'eu-echr', name: '歐洲人權法院', country: 'INT', supranational: 'ECHR', search: async () => [], getDetail: async () => ({}) });
  assert.throws(() => r.register({ id: 'eu-echr', name: 'dup', country: 'INT', search: async () => [], getDetail: async () => ({}) }), /重複註冊/);
  assert.equal(r.list().length, 1);
  assert.equal(r.has('eu-echr'), true);
  assert.equal(r.get('eu-echr').name, '歐洲人權法院');
});

test('範圍整理依指定的管轄區搜尋與取得內頁（完全不連網）', async () => {
  const calls = [];
  jurisdictionRegistry.register({
    id: 'test-fake',
    name: '測試管轄區',
    country: 'XX',
    search: async (kw, o) => { calls.push(['search', kw, o.maxItems]); return [{ id: 'A1', title: 't', dateIso: '2024-01-02', cause: '' }]; },
    getDetail: async (id) => { calls.push(['detail', id]); return fakeDetail(id, '測試法'); },
  });
  const rows = await buildScopeTable({ statute: '測試法', jurisdiction: 'test-fake', maxItems: 5, client: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'A1');
  assert.equal(rows[0].court, '測試法院');
  assert.deepEqual(calls.map((c) => c[0]), ['search', 'detail']);
  assert.equal(calls[0][1], '測試法');
});
