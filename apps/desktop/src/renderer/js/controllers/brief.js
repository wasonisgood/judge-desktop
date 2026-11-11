// 控制器：單一判決（找候選、選定、精讀欄位、執行、可取消、匯出）。
// v3.6.0：單頁同時只一項工作；取消不產生文書；引文移除數量與法規內容缺口會明確顯示；存檔失敗提示。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;
  var PAGE = 'brief';

  // 候選判決清單（最近一次查找的結果）：助理可依 id 選定其中一則。
  var lastCandidates = [];
  function onCandidatePicked(it, tr) {
    setPick(it);
    document.querySelectorAll('#briefCandidateBody tr').forEach(function (x) { x.classList.toggle('row-picked', x === tr); });
    JR.setStatus($('briefStatus'), '已選定，可以整理這則判決。', 'ok');
  }
  function pickById(id) {
    var idx = -1;
    lastCandidates.forEach(function (it, i) { if (idx < 0 && it.id === id) idx = i; });
    if (idx < 0) return { ok: false, reason: '候選清單中沒有判決「' + id + '」，請先查找候選。' };
    var tr = document.querySelectorAll('#briefCandidateBody tr')[idx];
    onCandidatePicked(lastCandidates[idx], tr);
    return { ok: true };
  }

  function setPick(item) {
    state.briefPick = item;
    JR.views.renderPick(item);
    // 個案研究筆記：選定案件後，全文標注區塊可直接使用（不需先精讀）。
    JR.controllers.annotation.prepare(item ? { id: item.id, title: item.title, jurisdiction: $('briefJurisdiction').value } : null);
  }

  function collectBriefFields() {
    var out = [];
    document.querySelectorAll('#briefFieldList .brief-field-row').forEach(function (row) {
      out.push({
        name: row.querySelector('.brief-field-name').value.trim(),
        description: row.querySelector('.brief-field-desc').value.trim(),
        enabled: row.querySelector('.brief-field-on').checked
      });
    });
    return out;
  }

  function annotationText(an) {
    if (an.error) return '原版標示未完成：' + an.error;
    return '原版標示：已產生 ' + (an.files || []).length + ' 份 Word（每份 4 頁），標示 ' + (an.highlighted || 0) + ' 處' + ((an.ocrPages || []).length ? '；第 ' + an.ocrPages.join('、') + ' 頁沒有文字層，無法標示' : '');
  }

  JR.controllers.brief = {
    /** 從列表或範圍整理表帶入一則判決，並切換到精讀頁。 */
    /** queueItems：同一批結果（列表或範圍整理的該表），用於逐案閱讀的上一案／下一案。 */
    openFromList: function (item, queueItems) {
      setPick({ id: item.id, title: item.title, dateIso: item.dateIso || item.dateDisplay || '' });
      var jur = $('briefJurisdiction').value;
      var queue = (queueItems || []).map(function (q) { return { id: q.id, title: q.title || q.id, dateIso: q.dateIso || q.dateDisplay || '', jurisdiction: jur }; });
      var idx = -1;
      queue.forEach(function (q, i) { if (q.id === item.id) idx = i; });
      JR.controllers.annotation.setQueue(queue, idx, jur);
      JR.setStatus($('briefStatus'), '已從上一頁帶入這則判決，可以直接整理。', 'ok');
      JR.nav.showPage('brief');
    },
    /** 從「檔案」開啟已保存的精讀結果。管轄區以結果中記錄的為準（舊結果沒有記錄時才沿用表單的值）。 */
    showResult: function (view) {
      state.brief = view;
      JR.views.renderBrief(view);
      $('briefExport').disabled = false;
      var jur = view.jurisdiction != null ? view.jurisdiction : $('briefJurisdiction').value;
      JR.controllers.annotation.open(view.detail.meta.id, jur, view.detail.meta.title);
    },
    setPick: setPick,
    pickById: pickById,
    bind: function () {
      $('briefFindForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        $('briefFind').disabled = true;
        JR.setStatus($('briefFindStatus'), '搜尋中…');
        try {
          // 自然語言（例如「我想找高院的戒嚴補償」）先由 AI 整理成查詢詞，回填後再搜尋。
          var query = $('briefQuery').value.trim();
          var nl = await JR.nl.interpret(PAGE, query, $('briefAi') ? $('briefAi').value : 'auto');
          if (nl.mode === 'natural' && nl.fields.query) {
            query = nl.fields.query;
            $('briefQuery').value = query;
          }
          var r = await api.judgment.find({ query: query, jurisdiction: $('briefJurisdiction').value });
          lastCandidates = r.items;
          JR.views.renderCandidates(r.items, onCandidatePicked);
          var msg = r.items.length ? '找到 ' + r.items.length + ' 筆候選，請選定一則。' : '沒有找到符合的判決。可以換個關鍵字，或使用縮寫。';
          JR.setStatus($('briefFindStatus'), msg + (r.note ? '　' + r.note : ''), r.items.length ? 'ok' : '');
        } catch (err) {
          JR.setStatus($('briefFindStatus'), '搜尋失敗：' + JR.errText(err), 'error');
        } finally {
          $('briefFind').disabled = false;
        }
      });

      $('briefForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        if (JR.jobs.isBusy(PAGE)) {
          JR.setStatus($('briefStatus'), '精讀已有工作進行中，請等候完成或按「取消」。', 'error');
          return;
        }
        if (!state.briefPick) {
          JR.setStatus($('briefStatus'), '請先在候選中選定一則判決。', 'error');
          return;
        }
        var fieldRows = collectBriefFields();
        var fields = fieldRows.filter(function (f) { return f.enabled && f.name; }).map(function (f) { return { name: f.name, description: f.description }; });
        if (fields.length === 0) {
          JR.setStatus($('briefStatus'), '請至少勾選一個要整理的欄位。', 'error');
          return;
        }
        api.settings.set({ briefFields: fieldRows.filter(function (f) { return f.name; }) }).catch(function (err) {
          JR.setStatus($('briefStatus'), '欄位設定沒有保存：' + JR.errText(err), 'error');
        });
        $('briefRun').disabled = true;
        $('briefExport').disabled = true;
        var runId = JR.jobs.start(PAGE, 'briefCancel');
        JR.setStatus($('briefStatus'), '讀取判決中…');
        try {
          var r = await api.brief.run({
            runId: runId,
            judgmentId: state.briefPick.id,
            focus: $('briefFocus').value.trim(),
            lengthHint: $('briefLength').value,
            jurisdiction: $('briefJurisdiction').value,
            caseType: $('briefCaseType').value,
            ai: $('briefAi').value,
            fields: fields
          });
          state.brief = r;
          if (r.detail && r.detail.meta && r.detail.meta.title) $('briefPicked').textContent = r.detail.meta.title;
          JR.views.renderBrief(r);
          JR.controllers.annotation.open(state.briefPick.id, r.jurisdiction != null ? r.jurisdiction : $('briefJurisdiction').value, r.detail.meta.title);
          state.assistHistory.push({ role: 'user', text: '[系統通知] 精讀已完成：' + (r.doc.title || '') + '。段落：' + r.doc.sections.map(function (sec) { return sec.heading + '：' + sec.paragraphs.join(' '); }).join(' ').slice(0, 3000) });
          var an = r.annotated || {};
          var parts = ['已完成 AI 整理' + (r.saveError ? '。' : '，已存入「檔案」。')];
          if (r.saveError) parts.push(r.saveError);
          parts.push(annotationText(an));
          if (r.doc.droppedQuotes) parts.push('已移除 ' + r.doc.droppedQuotes + ' 則無法在判決原文中找到的引文。');
          if ((r.lawNotes || []).length) parts.push('法規內容未完整取得：' + r.lawNotes.join('；'));
          if (r.caseTypeNote) parts.push(r.caseTypeNote);
          JR.setStatus($('briefStatus'), parts.join('　'), (an.error || r.saveError) ? 'error' : 'ok');
          state.briefExplanation = r.explanation;
          $('briefExplain').disabled = !r.explanation;
          $('briefExport').disabled = false;
        } catch (err) {
          if (err && err.message && /已取消/.test(err.message)) {
            JR.setStatus($('briefStatus'), '已取消，未產生文書。', 'error');
          } else {
            JR.setStatus($('briefStatus'), '讀取失敗：' + JR.errText(err), 'error');
          }
        } finally {
          JR.jobs.finish(PAGE);
          $('briefRun').disabled = !state.briefPick;
        }
      });

      $('briefExplain').addEventListener('click', function () {
        if (state.briefExplanation) JR.components.explainDialog(state.briefExplanation);
      });
      $('briefExport').addEventListener('click', async function () {
        if (!state.brief) return;
        try {
          var r = await api.brief.export({ detail: state.brief.detail, doc: state.brief.doc });
          if (!r.canceled) JR.setStatus($('briefStatus'), '已匯出：' + r.filePath, 'ok');
        } catch (err) {
          JR.setStatus($('briefStatus'), '匯出失敗：' + JR.errText(err), 'error');
        }
      });
    }
  };
})(window.JR);
