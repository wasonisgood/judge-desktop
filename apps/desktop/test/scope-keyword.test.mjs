// 標編碼標注工序的整合測試（不需要網路與金鑰）：以假的司法院搜尋、內頁、法規與 AI 取代外部來源，
// 驗證 scopeService 的關鍵字模式、智慧搜尋的語意確認、相關法規篩選、既有法規輸入與 AI 編碼。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// 先把外部依賴換成替身（直接放進 require.cache），再載入 scopeService。
function stub(rel, exportsObj) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [], paths: [] };
}

const DETAILS = {
  A: {
    meta: { id: 'A', title: '案A', court: '臺灣高等法院', dateIso: '2021-01-01', dateMinguo: '110.1.1', cause: '國家賠償', sourceUrl: 'https://example.test/A' },
    sections: { 主文: '上訴駁回。' }, history: [], historyPosition: null,
    relatedLaws: ['國家賠償法第2條'], fullText: '依國家賠償法第二條請求，本院認為應予駁回。',
  },
  B: {
    meta: { id: 'B', title: '案B', court: '臺灣高等法院', dateIso: '2022-01-01', dateMinguo: '111.1.1', cause: '戒嚴', sourceUrl: 'https://example.test/B' },
    sections: { 主文: '上訴駁回。' }, history: [], historyPosition: null,
    relatedLaws: [], fullText: '本案與戒嚴事件有關，未引用法條。',
  },
};
const SEARCH = {
  '戒嚴 賠償': [DETAILS.A, DETAILS.B],
  '國家賠償法': [DETAILS.A, DETAILS.B],
};
const toSummary = (d) => ({ id: d.meta.id, title: d.meta.title, dateDisplay: d.meta.dateMinguo, dateIso: d.meta.dateIso, cause: d.meta.cause, href: d.meta.sourceUrl });

stub('../dist/main/data/cloud/courtRepo.js', {
  cachedSearch: async (q) => (SEARCH[q] ?? []).map(toSummary),
  cachedDetail: async (id) => DETAILS[id],
});
stub('../dist/main/data/cloud/lawRepo.js', {
  resolveStatuteOrCandidates: async (name) => ({ status: 'ok', name, pcode: 'P1' }),
  lawHistoryFor: async () => [],
  currentLawFor: async () => ({ pcode: 'P1', name: '國家賠償法', articles: [] }),
});
const SAVED = [];
stub('../dist/main/services/savedResult.js', { saveToLibrary: async (item) => { SAVED.push(item); return { saveError: null }; } });
stub('../dist/main/services/lawContext.js', { lawContextForStatute: async () => ({ text: '', notes: [], statuteName: null }) });
stub('../dist/main/services/knowledgeService.js', { knowledgeContextWithReview: async () => ({ text: '', usedIds: [], notes: [] }) });

const svc = require('../dist/main/services/scopeService.js');

const FIELDS = [{ id: 'issue', name: '爭點' }, { id: 'outcome', name: '結論' }, { name: '原告請求的金額' }];

/** 假 AI：依提示詞辨識用途。unclear 時改為回報語意不清。 */
function makeAi({ unclear = false } = {}) {
  const calls = { analysis: 0, propose: 0 };
  const ai = async (system, user) => {
    if (system.includes('改寫成司法院判決查詢的關鍵字')) {
      calls.propose++;
      return unclear
        ? JSON.stringify({ unclear: true, question: '您指的是哪一種？', candidates: [{ label: '刑事戒嚴', description: '刑事案件' }] })
        : JSON.stringify({ unclear: false, queries: ['國家賠償'], reason: 'r' });
    }
    if (user.includes('逐案分析（JSON）')) return JSON.stringify({ overview: '概述', groups: [], trends: '趨勢', conclusion: '結論' });
    calls.analysis++;
    const ids = [...user.matchAll(/id「([^」]+)」/g)].map((m) => m[1]);
    return JSON.stringify({ values: ids.map((id) => ({ id, value: `值-${id}`, evidence: [] })) });
  };
  return { ai, calls };
}

const run = (args, ai) => svc.runScope({ maxItems: 10, statutes: [], fields: FIELDS, ...args }, ai, () => {});

test('既有的法規每行一部輸入仍可用，只保留真的引用該法規的判決', async () => {
  const { ai } = makeAi();
  const r = await run({ statutes: ['國家賠償法'], aiAnalysis: true }, ai);
  assert.equal(r.status, 'done');
  assert.equal(r.sheets.length, 1);
  assert.equal(r.sheets[0].statute, '國家賠償法');
  assert.deepEqual(r.sheets[0].rows.map((x) => x.id), ['A']);
  assert.equal(r.sheets[0].analyses[0].values.length, FIELDS.length);
});

test('關鍵字模式：搜尋結果全部列出（不以法規篩選），標題為關鍵字', async () => {
  const { ai } = makeAi();
  const r = await run({ keyword: '戒嚴 賠償', smart: false, aiAnalysis: true }, ai);
  assert.equal(r.status, 'done');
  assert.equal(r.sheets[0].statute, '關鍵字：戒嚴 賠償');
  assert.deepEqual(r.sheets[0].rows.map((x) => x.id), ['A', 'B']);
});

test('相關法規篩選：預設關閉時不篩選；開啟後只保留引用該法規的判決', async () => {
  const { ai } = makeAi();
  const off = await run({ keyword: '戒嚴 賠償', relatedStatute: '國家賠償法', relatedOnly: false, aiAnalysis: true }, ai);
  assert.deepEqual(off.sheets[0].rows.map((x) => x.id), ['A', 'B']);
  assert.match(off.sheets[0].statute, /相關法規：國家賠償法/);
  const on = await run({ keyword: '戒嚴 賠償', relatedStatute: '國家賠償法', relatedOnly: true, aiAnalysis: true }, ai);
  assert.deepEqual(on.sheets[0].rows.map((x) => x.id), ['A']);
});

test('智慧搜尋語意不清：回傳與法名相同的候選選項（target 為 keyword），不直接執行', async () => {
  const { ai } = makeAi({ unclear: true });
  const r = await run({ keyword: '無結果的說法', smart: true, aiAnalysis: true }, ai);
  assert.equal(r.status, 'ask');
  assert.equal(r.target, 'keyword');
  assert.equal(r.statuteLine, '無結果的說法');
  assert.equal(r.options[0].label, '刑事戒嚴');
  assert.equal(r.options.at(-1).id, 'manual', '最後一項是自行輸入更正');
});

test('智慧搜尋沒有結果時，AI 會提議新關鍵字並再查，達上限後以目前結果結束（不卡住）', async () => {
  const { ai, calls } = makeAi();
  const r = await run({ keyword: '無結果的說法', smart: true, aiAnalysis: true }, ai);
  assert.equal(r.status, 'done');
  assert.ok(calls.propose >= 1, '應該有提議新關鍵字');
  assert.equal(r.sheets[0].rows.length, 0, '提議的關鍵字（國家賠償）在測試資料中沒有結果');
  assert.ok(r.notes.some((n) => /關鍵字/.test(n)), '達上限時說明中要有建議');
});

test('沒有輸入法規也沒有關鍵字時明確拒絕', async () => {
  await assert.rejects(run({ keyword: '   ', statutes: [] }, null), /請輸入法規或關鍵字/);
});

test('AI 關閉時關鍵字路徑不呼叫 AI，也不產生編碼', async () => {
  const r = await run({ keyword: '戒嚴 賠償', aiAnalysis: false }, null);
  assert.equal(r.status, 'done');
  assert.deepEqual(r.sheets[0].rows.map((x) => x.id), ['A', 'B']);
  assert.deepEqual(r.sheets[0].analyses, []);
});

test('AI 編碼沒有依據時標示待覆核，並在說明中提示', async () => {
  const { ai } = makeAi();
  const r = await run({ keyword: '戒嚴 賠償', aiAnalysis: true }, ai);
  const v = r.sheets[0].analyses[0].values[0];
  assert.equal(v.reviewStatus, 'pending');
  assert.ok(r.notes.some((n) => /待覆核/.test(n)), '說明中要提示待覆核');
});

test('執行結束的流程面板：每個節點的狀態與說明句來自實際執行的紀錄', async () => {
  const { ai } = makeAi();
  const r = await run({ keyword: '戒嚴 賠償', relatedStatute: '國家賠償法', relatedOnly: true, aiAnalysis: true }, ai);
  const byId = Object.fromEntries(r.flow.map((n) => [n.id, n]));
  assert.equal(byId.search.status, 'done');
  assert.equal(byId.lookup.status, 'skipped', '只用關鍵字，不做法名確認');
  assert.equal(byId.coding.status, 'done');
  assert.ok(byId.filter.lines.some((l) => /相關法規篩選/.test(l) || /篩選結果/.test(l)));
  assert.ok(byId.coding.lines.some((l) => /AI 逐案編碼/.test(l)));
  assert.ok(byId.verify.lines.some((l) => /依據驗證/.test(l)));
  assert.match(r.explanation.paragraphs.at(-1), /^結果：/);
  assert.ok(r.explanation.paragraphs.some((p) => /AI 設定：.*自動調整搜尋用語/.test(p)));
});

test('進度事件附上流程狀態：進行中的階段與之前的完成', async () => {
  const { ai } = makeAi();
  const events = [];
  await svc.runScope({ maxItems: 10, statutes: [], keyword: '戒嚴 賠償', fields: FIELDS, aiAnalysis: true }, ai, (p) => events.push(p));
  const coding = events.find((p) => p.phase === 'AI 逐案編碼');
  assert.ok(coding, '應有逐案編碼的進度');
  const s = Object.fromEntries(coding.flow.map((n) => [n.id, n.status]));
  assert.equal(s.coding, 'running');
  assert.equal(s.search, 'done');
  assert.equal(s.synthesis, 'pending');
});

test('流程紀錄即時推送：每寫入一步就有一則進度事件，說明句立即可見', async () => {
  const { ai } = makeAi();
  const events = [];
  await svc.runScope({ maxItems: 10, statutes: [], keyword: '戒嚴 賠償', fields: FIELDS, aiAnalysis: true }, ai, (p) => events.push(p));
  const recordOnly = events.filter((p) => !p.phase && p.flow);
  assert.ok(recordOnly.length >= 3, `應有多則紀錄事件，實際 ${recordOnly.length}`);
  const search = (flow) => flow.find((n) => n.id === 'search');
  const firstWithSearch = recordOnly.find((p) => search(p.flow).lines.length > 0);
  assert.ok(firstWithSearch, '搜尋的說明句應在執行中就出現');
  assert.ok(!firstWithSearch.flow.find((n) => n.id === 'coding').lines.length, '編碼還沒做完，不應先出現');
});

test('保存的結果帶著處理流程與說明（從檔案開啟時使用）', async () => {
  const { ai } = makeAi();
  SAVED.length = 0;
  const r = await run({ keyword: '戒嚴 賠償', aiAnalysis: true }, ai);
  // 結果會透過 IPC 傳回畫面，必須能被結構化複製（Proxy 不行）。
  assert.doesNotThrow(() => structuredClone(r));
  const payload = SAVED.at(-1).payload;
  assert.ok(Array.isArray(payload.flow) && payload.flow.length === 7);
  assert.match(payload.explanation.paragraphs.at(-1), /^結果：/);
  assert.equal(payload.trace.steps.length > 0, true);
});

test('scopeFlowInputOf 與執行參數一致', () => {
  const input = svc.scopeFlowInputOf({ statutes: ['國家賠償法'], keyword: ' 戒嚴 ', relatedStatute: '', relatedOnly: true, smart: true, aiAnalysis: false, fields: FIELDS, maxItems: 10 });
  assert.deepEqual(input, { statutes: ['國家賠償法'], keyword: '戒嚴', relatedStatute: '', relatedOnly: true, smart: true, aiOn: false, fieldCount: 3 });
});
