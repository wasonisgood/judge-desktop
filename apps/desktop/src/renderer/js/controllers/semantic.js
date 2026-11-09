// 控制器：段落檢索（候選、排序、展開全文）與結果內小助手。小助手只看得到目前結果集；對話紀錄只存在本頁記憶體中，不寫入雲端。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var el = JR.el;
  var api = window.api;
  var PAGE = 'semantic';
  var MAX_CANDIDATES = 500;

  var current = null; // { run, kind, query, keyword }
  var chat = [];
  var running = false;
  var asking = false;

  function filterOptions() {
    return {
      courtLevel: $('semCourt').value,
      caseType: $('semType').value,
      yearFrom: Number($('semFrom').value) || undefined,
      yearTo: Number($('semTo').value) || undefined
    };
  }

  function candidateLimit() {
    var n = Math.floor(Number($('semMax').value));
    return Math.min(MAX_CANDIDATES, Math.max(1, n || 200));
  }

  function setRunning(on) {
    $('semRun').disabled = on;
  }

  function groupsOf(run) {
    return $('semSort').value === 'caseNo' ? run.byCaseNo : run.bySimilarity;
  }

  function renderCurrent() {
    if (!current) return;
    JR.views.renderSemanticResult(groupsOf(current.run), current.run, expandFullText);
    $('semAsk').disabled = !current.run.bySimilarity.length || asking;
  }

  function expandFullText(caseId, box) {
    box.innerHTML = '';
    box.appendChild(el('p', 'hint', '載入全文中…'));
    api.semantic.fullText({ id: caseId }).then(function (d) {
      box.innerHTML = '';
      box.dataset.loaded = '1';
      box.appendChild(el('div', 'semantic-fulltext-body', d.fullText || '（沒有全文）'));
      if (d.sourceUrl) box.appendChild(el('p', 'hint semantic-source', '來源：' + d.sourceUrl));
    }).catch(function (err) {
      box.innerHTML = '';
      box.appendChild(el('p', 'status error', '全文讀取失敗：' + JR.errText(err)));
    });
  }

  /** 小助手的範圍：目前結果集（依相似度分組的全部案件；與排序方式無關）。沒有案號者無法對照，不納入。 */
  function resultCases() {
    var cases = [];
    var skipped = 0;
    current.run.bySimilarity.forEach(function (g) {
      if (g.caseNo) cases.push({ caseNo: g.caseNo, passages: g.hits.map(function (h) { return h.passageText; }) });
      else skipped++;
    });
    return { cases: cases, skipped: skipped };
  }

  JR.controllers.semantic = {
    bind: function () {
      $('semCancel').addEventListener('click', function () { JR.jobs.cancel(PAGE); });
      $('semForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        if (JR.jobs.isBusy(PAGE) || running) {
          JR.setStatus($('semStatus'), '段落檢索已有工作進行中，請等候完成或按「取消」。', 'error');
          return;
        }
        var keyword = $('semKeyword').value.trim();
        var query = $('semQuery').value.trim();
        if (!keyword) { JR.setStatus($('semStatus'), '請輸入候選關鍵字。', 'error'); return; }
        if (!query) { JR.setStatus($('semStatus'), '請輸入研究問題，AI 會依它排序段落。', 'error'); return; }
        var kind = $('semKind').value;
        running = true;
        setRunning(true);
        $('semResult').innerHTML = '';
        $('semSummary').hidden = true;
        $('semAsk').disabled = true;
        $('semProgress').hidden = false;
        $('semProgress').querySelector('.bar').style.width = '0%';
        chat = [];
        JR.controllers.semantic.renderChat();
        var runId = JR.jobs.start(PAGE, 'semCancel');
        JR.setStatus($('semStatus'), '以關鍵字取得候選中…（每筆判決都要讀取內文，最多 ' + MAX_CANDIDATES + ' 筆，請耐心等候）');
        try {
          var r = await api.semantic.run({
            runId: runId, keyword: keyword, query: query, kind: kind,
            filter: filterOptions(), maxCandidates: candidateLimit(), ai: $('semAi').value
          });
          current = { run: r, kind: kind, query: query, keyword: keyword };
          if (r.cancelled) {
            $('semResult').innerHTML = '';
            JR.setStatus($('semStatus'), '已取消，未完成段落排序。', 'error');
          } else {
            JR.views.renderSemanticSummary(r, $('semSort').value, kind);
            renderCurrent();
            var msg = '候選 ' + r.candidates + ' 筆，篩選後 ' + r.considered + ' 筆，讀取內文 ' + r.fetched + ' 筆，含相關段落的判決 ' + r.bySimilarity.length + ' 件。';
            if (r.notes.length) msg += '（' + r.notes.length + ' 筆內文讀取失敗，已略過）';
            JR.setStatus($('semStatus'), msg, r.notes.length || r.notice ? 'error' : 'ok');
          }
        } catch (err) {
          JR.setStatus($('semStatus'), '檢索失敗：' + JR.errText(err), 'error');
        } finally {
          JR.jobs.finish(PAGE);
          running = false;
          setRunning(false);
          $('semProgress').hidden = true;
          $('semAsk').disabled = !(current && current.run.bySimilarity.length) || asking;
        }
      });

      api.semantic.onProgress(function (p) {
        if (!running) return;
        $('semProgress').querySelector('.bar').style.width = Math.round((p.done / Math.max(p.total, 1)) * 100) + '%';
        JR.setStatus($('semStatus'), p.phase + '：' + p.done + ' / ' + p.total);
      });

      $('semSort').addEventListener('change', function () {
        if (!current) return;
        JR.views.renderSemanticSummary(current.run, $('semSort').value, current.kind);
        renderCurrent();
      });

      $('semAskForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        if (asking) return;
        var question = $('semQuestion').value.trim();
        if (!current || !current.run.bySimilarity.length) { JR.setStatus($('semAskStatus'), '請先完成一次段落檢索。', 'error'); return; }
        if (!question) { JR.setStatus($('semAskStatus'), '請輸入問題。', 'error'); return; }
        var scope = resultCases();
        if (!scope.cases.length) { JR.setStatus($('semAskStatus'), '結果集中沒有可對照案號的判決。', 'error'); return; }
        asking = true;
        $('semAsk').disabled = true;
        chat.push({ role: 'user', text: question });
        JR.controllers.semantic.renderChat();
        JR.setStatus($('semAskStatus'), '小助手回答中…');
        try {
          var r = await api.semantic.ask({
            runId: JR.jobs.newRunId(), question: question, cases: scope.cases, ai: $('semAi').value
          });
          chat.push({ role: 'assistant', text: r.answer, check: r.check, omitted: r.omitted });
          $('semQuestion').value = '';
          var note = r.check.status === 'ok'
            ? '回答已通過檢查（引用 ' + r.check.cited.length + ' 個案號，皆在結果集內）。'
            : '回答未通過檢查，請見對話中的警告。';
          if (scope.skipped) note += '（另有 ' + scope.skipped + ' 件因無法辨識案號未納入）';
          JR.setStatus($('semAskStatus'), note, r.check.status === 'ok' ? 'ok' : 'error');
        } catch (err) {
          chat.push({ role: 'error', text: '小助手無法回答：' + JR.errText(err) });
          JR.setStatus($('semAskStatus'), '', '');
        } finally {
          asking = false;
          $('semAsk').disabled = !current.run.bySimilarity.length;
          JR.controllers.semantic.renderChat();
        }
      });

      $('semClearChat').addEventListener('click', function () {
        chat = [];
        JR.controllers.semantic.renderChat();
        JR.setStatus($('semAskStatus'), '已清除對話。');
      });
    },

    renderChat: function () {
      JR.views.renderSemanticChat(chat);
    }
  };
})(window.JR);
