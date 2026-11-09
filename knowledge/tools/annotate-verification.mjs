// 把條文核實結果逐爭點註記到知識庫資料檔（欄位 lawVerification）。
// 用法：node knowledge/tools/annotate-verification.mjs <資料目錄> <law-refs.json>
// 只新增 lawVerification 欄位，不改動任何文字內容。
import fs from 'node:fs';
import path from 'node:path';

const [dataDirArg, verArg] = process.argv.slice(2);
if (!dataDirArg || !verArg) {
  console.error('用法：node annotate-verification.mjs <資料目錄> <law-refs.json>');
  process.exit(2);
}
const dataDir = path.resolve(dataDirArg);
const { results } = JSON.parse(fs.readFileSync(path.resolve(verArg), 'utf8'));
const byRaw = new Map(results.map((r) => [r.raw, r]));

/** 把核實結果壓縮成一行可讀的摘要：狀態、條文摘要、修法日期。 */
function summarize(row) {
  const latest = row.historyDates.flatMap((h) => h.versions).map((v) => v.date).filter(Boolean).sort().pop() ?? null;
  return {
    ref: row.raw,
    status: row.status,
    checks: row.checks.map((c) => ({ article: c.article, paragraph: c.paragraph, item: c.item, ok: c.ok, currentText: c.currentText ?? null })),
    latestAmendmentDate: latest,
    amendments: row.historyDates.flatMap((h) => h.versions.map((v) => ({ article: h.article, date: v.date, kind: v.kind }))),
    note: row.note,
  };
}

let issues = 0;
for (const f of fs.readdirSync(dataDir).filter((x) => x.endsWith('.json')).sort()) {
  const p = path.join(dataDir, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const issue of j.issues) {
    issues++;
    issue.lawVerification = issue.lawRefs.map((ref) => {
      const row = byRaw.get(ref);
      return row ? summarize(row) : { ref, status: 'unverified', checks: [], amendments: [], latestAmendmentDate: null, note: '未納入核實' };
    });
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
}
console.log(`已註記 ${issues} 個爭點`);
