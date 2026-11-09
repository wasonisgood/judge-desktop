// 控制器：單一判決（找候選、選定、精讀欄位、執行、可取消、匯出）。
// v3.6.0：單頁同時只一項工作；取消不產生文書；引文移除數量與法規內容缺口會明確顯示；存檔失敗提示。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;
  var PAGE = 'brief';

  function setPick(item) {
    state.briefPick = item;
    JR.views.renderPick(item);
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
    openFromList: function (item) {
      setPick({ id: item.id, title: item.title, dateIso: item.dateIso || item.dateDisplay || '' });
      JR.setStatus($('briefStatus'), '已從上一頁帶入這則判決，可以直接整理。', 'ok');
      JR.nav.showPage('brief');
    },
    /** 從「檔案」開啟已保存的精讀結果。 */
    showResult: function (view) {
      state.brief = view;
      JR.views.renderBrief(view);
      $('briefExport').disabled = false;
    },
    setPick: setPick,
    bind: function () {
      $('briefFindForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        $('briefFind').disabled = true;
        JR.setStatus($('briefFindStatus'), '搜尋中…');
        try {
          var r = await api.judgment.find({ query: $('briefQuery').value.trim(), jurisdiction: $('briefJurisdiction').value });
          JR.views.renderCandidates(r.items, function (it, tr) {
            setPick(it);
            document.querySelectorAll('#briefCandidateBody tr').forEach(function (x) { x.classList.toggle('row-picked', x === tr); });
            JR.setStatus($('briefStatus'), '已選定，可以整理這則判決。', 'ok');
          });
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
