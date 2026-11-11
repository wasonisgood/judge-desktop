// 條文與年代核實（程式核實，不依賴 AI 記憶）。
// 用法：node knowledge/tools/verify-laws.mjs <資料目錄> <輸出 JSON>
// 1. 從所有爭點的 lawRefs 抽出法規名稱與條號。
// 2. 以司法院法規資料庫查現行條文（確認條號存在、取得條文內容）。
// 3. 以立法院法律系統查條文沿革（修法日期與種類），作為年代核實依據。
// 所有結果寫入輸出 JSON；查不到的一律記為未通過，不做推定。
import fs from 'node:fs';
import path from 'node:path';
import * as core from '../../apps/desktop/node_modules/@judge/core/dist/index.js';

const [dataDirArg, outArg] = process.argv.slice(2);
if (!dataDirArg || !outArg) {
  console.error('用法：node verify-laws.mjs <資料目錄> <輸出 JSON>');
  process.exit(2);
}

const client = new core.LawClient({ fetchImpl: core.createCurlFetch(), minIntervalMs: 400 });

/** 從引用字串取出法規名稱（去掉括號註記與條號）。例如「刑事訴訟法第 159 條之 1」→「刑事訴訟法」。 */
function statuteOf(ref) {
  const clean = ref.replace(/（[^）]*）/g, '').trim();
  const idx = clean.indexOf('第');
  return (idx > 0 ? clean.slice(0, idx) : clean).trim();
}

const dataDir = path.resolve(dataDirArg);
const refMap = new Map(); // 原始字串 → { statute, cites }
let issueCount = 0;
for (const f of fs.readdirSync(dataDir).filter((x) => x.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
  for (const issue of j.issues) {
    issueCount++;
    for (const ref of issue.lawRefs) {
      if (!refMap.has(ref)) refMap.set(ref, { statute: statuteOf(ref), cites: core.parseCitations(ref.replace(/（[^）]*）/g, '')) });
    }
  }
}

// 資料庫的正式法名；簡稱在此對照。
const ALIASES = { 刑法: '中華民國刑法', 憲法: '中華民國憲法' };

const statuteCache = new Map(); // 法規名稱 → { pcode, law, history, error }
async function loadStatute(alias) {
  const name = ALIASES[alias] ?? alias;
  if (statuteCache.has(name)) return statuteCache.get(name);
  const entry = { pcode: null, law: null, history: null, error: null };
  statuteCache.set(name, entry);
  try {
    const { exact } = await client.searchMojByName(name);
    if (!exact) {
      entry.error = '法規名稱無完全相符結果';
      return entry;
    }
    entry.pcode = exact.pcode;
    entry.law = await client.fetchCurrentLaw(exact.pcode);
  } catch (e) {
    entry.error = `現行條文抓取失敗：${e.message}`;
  }
  try {
    const h = await client.fetchLawHistory(name);
    entry.history = h.history;
  } catch (e) {
    entry.history = null;
    entry.historyError = `沿革抓取失敗：${e.message}`;
  }
  return entry;
}

const results = [];
let n = 0;
for (const [raw, info] of refMap) {
  n++;
  const row = { raw, statute: info.statute, status: 'unverified', pcode: null, checks: [], historyDates: [], note: null };
  if (!info.statute) {
    row.status = 'no-statute';
    results.push(row);
    continue;
  }
  if (info.cites.length === 0) {
    row.status = 'no-article';
    row.note = '引用字串沒有可辨識的條號';
    results.push(row);
    continue;
  }
  const entry = await loadStatute(info.statute);
  row.pcode = entry.pcode;
  if (entry.error) row.note = entry.error;
  if (entry.historyError) row.note = [row.note, entry.historyError].filter(Boolean).join('；');
  for (const c of info.cites) {
    if (!entry.law) {
      row.checks.push({ article: c.article, paragraph: c.paragraph ?? null, item: c.item ?? null, ok: false, reason: 'no-law' });
      continue;
    }
    const text = core.currentArticleText(entry.law, c.article, c.paragraph, c.item);
    const hist = entry.history?.find((h) => h.article === c.article || h.noText === `第 ${c.article} 條` || h.noText === `第${c.article}條`);
    row.checks.push({
      article: c.article, paragraph: c.paragraph ?? null, item: c.item ?? null,
      ok: text !== null, currentText: text ? text.slice(0, 120) : null,
    });
    if (hist) {
      row.historyDates.push({ article: c.article, versions: hist.versions.map((v) => ({ date: v.date, kind: v.kind, reason: v.reason })) });
    }
  }
  const allOk = row.checks.every((c) => c.ok);
  row.status = allOk ? 'verified' : 'failed';
  results.push(row);
  if (n % 25 === 0) console.error(`已核實 ${n}/${refMap.size}`);
}

const summary = {
  issues: issueCount,
  uniqueRefs: refMap.size,
  statutes: [...statuteCache.keys()].length,
  byStatus: results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
  statuteErrors: [...statuteCache.entries()].filter(([, v]) => v.error || v.historyError).map(([k, v]) => ({ statute: k, error: v.error, historyError: v.historyError ?? null })),
};
fs.mkdirSync(path.dirname(path.resolve(outArg)), { recursive: true });
fs.writeFileSync(path.resolve(outArg), JSON.stringify({ summary, results }, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
