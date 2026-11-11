// 條文查詢工具：查現行條文與修法沿革（程式核實，供內容修正時使用）。
// 用法：
//   node knowledge/tools/lookup.mjs <法名> <條號> [項] [款]
//   node knowledge/tools/lookup.mjs <法名> --search <關鍵字>     列出現行條文中含關鍵字的條號
// 法名可用簡稱（刑法→中華民國刑法、憲法→中華民國憲法）。
import * as core from '../../apps/desktop/node_modules/@judge/core/dist/index.js';

const ALIASES = { 刑法: '中華民國刑法', 憲法: '中華民國憲法' };
const [aliasArg, ...rest] = process.argv.slice(2);
if (!aliasArg) {
  console.error('用法：node lookup.mjs <法名> <條號> [項] [款]　或　node lookup.mjs <法名> --search <關鍵字>');
  process.exit(2);
}
const name = ALIASES[aliasArg] ?? aliasArg;
const client = new core.LawClient({ fetchImpl: core.createCurlFetch(), minIntervalMs: 400 });
const { exact } = await client.searchMojByName(name);
if (!exact) {
  console.log(JSON.stringify({ ok: false, reason: `法規名稱無完全相符結果：${name}` }));
  process.exit(0);
}
const law = await client.fetchCurrentLaw(exact.pcode);

if (rest[0] === '--search') {
  const kw = rest[1] ?? '';
  const hits = law.articles.filter((a) => (a.lines ?? []).join('').includes(kw) || (a.text ?? '').includes(kw))
    .map((a) => a.noText ?? a.article);
  console.log(JSON.stringify({ ok: true, statute: exact.name, keyword: kw, articles: hits.slice(0, 80) }, null, 2));
  process.exit(0);
}

const [article, paragraphArg, itemArg] = rest;
const paragraph = paragraphArg ? Number(paragraphArg) : undefined;
const item = itemArg ? Number(itemArg) : undefined;
const text = core.currentArticleText(law, article, paragraph, item);
let amendments = [];
try {
  const h = await client.fetchLawHistory(name);
  const hist = h.history.find((x) => x.article === article || x.noText === `第 ${article} 條` || x.noText === `第${article}條`);
  amendments = hist ? hist.versions.map((v) => ({ date: v.date, kind: v.kind, reason: v.reason })) : [];
} catch (e) {
  amendments = [{ error: `沿革抓取失敗：${e.message}` }];
}
console.log(JSON.stringify({ ok: text !== null, statute: exact.name, article, paragraph: paragraph ?? null, item: item ?? null, currentText: text, amendments }, null, 2));
