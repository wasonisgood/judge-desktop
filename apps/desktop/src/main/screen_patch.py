import io, os

ROOT = r'C:\Users\user\code\judge-desktop\apps\desktop\src'

def rd(p):
    return io.open(p, encoding='utf-8').read()

def wr(p, s):
    io.open(p, 'w', encoding='utf-8').write(s)

def rep(s, old, new):
    n = s.count(old)
    assert n == 1, 'anchor count %d: %s' % (n, old[:70])
    return s.replace(old, new)

NL = chr(10)

# ---- 主程序 ----
p = ROOT + r'\main\main.ts'
m = rd(p)
m = rep(m, "  FederatedTokenProvider, type FederationConfig, resolveLawName, DEFAULT_BRIEF_FIELDS, normalizeBriefFields, type BriefField,",
        "  FederatedTokenProvider, type FederationConfig, resolveLawName, DEFAULT_BRIEF_FIELDS, normalizeBriefFields, type BriefField,\n  screenRelevance, type RelevanceItem,")
# 助理讀判決：改讀全文的理由部分（主文＋理由節錄，上限 6000 字）
m = rep(m, "        const main = (d.sections['主文'] ?? '').slice(0, 800);\n        return { content: JSON.stringify({ title: d.meta.title, court: d.meta.court, date: d.meta.dateIso, cause: d.meta.cause, main }) };",
        "        const main = (d.sections['主文'] ?? '').slice(0, 800);\n        const reasoningStart = d.fullText.search(/理\\s*由/);\n        const reasoning = (reasoningStart >= 0 ? d.fullText.slice(reasoningStart) : d.fullText).slice(0, 6000);\n        return { content: JSON.stringify({ title: d.meta.title, court: d.meta.court, date: d.meta.dateIso, cause: d.meta.cause, main, reasoning, fullTextChars: d.fullText.length }) };")
# 判決列表：AI 篩選 IPC
m = rep(m, "  ipcMain.handle('search:run', async (e, args: { keyword: string; courtCode?: string; maxItems: number; includeFullText: boolean }) => {",
        "  ipcMain.handle('search:screen', async (_e, args: { topic: string; items: RelevanceItem[] }) => {\n    const ai = await requireAi();\n    return screenRelevance(ai, args.topic, args.items.slice(0, 40));\n  });\n  ipcMain.handle('search:run', async (e, args: { keyword: string; courtCode?: string; maxItems: number; includeFullText: boolean }) => {")
wr(p, m)

# ---- 預載 ----
p = ROOT + r'\main\preload.ts'
t = rd(p)
t = rep(t, "    run: (args: unknown) => invoke('search:run', args),",
        "    run: (args: unknown) => invoke('search:run', args),\n    screen: (args: unknown) => invoke('search:screen', args),")
wr(p, t)

# ---- 畫面：搜尋後可用 AI 篩選；不相關的預設隱藏，可展開 ----
p = ROOT + r'\renderer\index.html'
h = rd(p)
h = rep(h, '            <button class="btn" type="button" id="listExport" disabled>匯出 Excel</button>',
        '            <button class="btn" type="button" id="listExport" disabled>匯出 Excel</button>\n            <button class="btn" type="button" id="listScreen" disabled>AI 篩選相關判決</button>')
h = rep(h, '            <thead><tr><th>序號</th><th>裁判字號</th><th>裁判日期</th><th>案由</th></tr></thead>',
        '            <thead><tr><th>序號</th><th>裁判字號</th><th>裁判日期</th><th>案由</th><th>AI 判斷</th><th></th></tr></thead>')
h = rep(h, '        <div class="table-wrap" id="listResult" hidden>',
        '        <p class="status" id="listScreenStatus" role="status"></p>\n        <div class="table-wrap" id="listResult" hidden>')
wr(p, h)

p = ROOT + r'\renderer\app.js'
j = rd(p)
j = rep(j, "  function renderList(items) {",
'''  // AI 篩選：依搜尋主題判斷相關性；相關的排前面並附理由，不相關的預設隱藏。
  var listVerdicts = null;
  function renderList(items) {
    var body = $('listBody');
    body.innerHTML = '';
    var shown = items.map(function (it, i) { return { it: it, i: i }; });
    if (listVerdicts) {
      shown.sort(function (a, b) {
        var va = listVerdicts[a.it.id] || { relevant: false }, vb = listVerdicts[b.it.id] || { relevant: false };
        return (vb.relevant ? 1 : 0) - (va.relevant ? 1 : 0) || a.i - b.i;
      });
      var hiddenCount = shown.filter(function (x) { return !(listVerdicts[x.it.id] || {}).relevant; }).length;
      shown = shown.filter(function (x) { return (listVerdicts[x.it.id] || {}).relevant || $('listShowAll').checked; });
      $('listScreenStatus').textContent = '相關 ' + (items.length - hiddenCount) + ' 筆，不相關 ' + hiddenCount + ' 筆' + (hiddenCount ? '（已隱藏，可勾選「顯示不相關」查看）' : '');
    }
    shown.forEach(function (x, n) {
      var it = x.it;
      var tr = document.createElement('tr');
      [String(n + 1), it.title, it.dateIso || it.dateDisplay || '', it.cause || ''].forEach(function (text, j) {
        var td = document.createElement('td');
        if (j === 0) td.className = 'num';
        if (j === 2) td.className = 'nowrap';
        td.textContent = text;
        tr.appendChild(td);
      });
      var v = listVerdicts && listVerdicts[it.id];
      var judge = document.createElement('td');
      judge.textContent = v ? ((v.relevant ? '相關：' : '不相關：') + v.reason) : '';
      tr.appendChild(judge);
      var bt = document.createElement('td');
      var b = document.createElement('button');
      b.className = 'btn small'; b.type = 'button'; b.textContent = '精讀這則';
      b.addEventListener('click', function () { briefFor(it); });
      bt.appendChild(b);
      tr.appendChild(bt);
      body.appendChild(tr);
    });
    $('listResult').hidden = items.length === 0;
  }''')
# 原本的 renderList 內容已被替換；移除舊的重複主體（保留後面的程式）
open(p, 'w', encoding='utf-8').write(j)
print('patch part 1 applied')
