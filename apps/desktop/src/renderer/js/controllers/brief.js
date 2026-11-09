// 控制器：單一判決（找候選、選定、精讀欄位、執行、匯出）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;

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
          var r = await api.judgment.find({ query: $('briefQuery').value.trim() });
          JR.views.renderCandidates(r.items, function (it, tr) {
            setPick(it);
            document.querySelectorAll('#briefCandidateBody tr').forEach(function (x) { x.classList.toggle('row-picked', x === tr); });
            JR.setStatus($('briefStatus'), '已選定，可以整理這則判決。', 'ok');
          });
          JR.setStatus($('briefFindStatus'), r.items.length ? '找到 ' + r.items.length + ' 筆候選，請選定一則。' : '沒有找到符合的判決。可以換個關鍵字，或使用縮寫。', r.items.length ? 'ok' : '');
        } catch (err) {
          JR.setStatus($('briefFindStatus'), '搜尋失敗：' + JR.errText(err), 'error');
        } finally {
          $('briefFind').disabled = false;
        }
      });

      $('briefForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
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
        api.settings.set({ briefFields: fieldRows.filter(function (f) { return f.name; }) });
        $('briefRun').disabled = true;
        $('briefExport').disabled = true;
        JR.setStatus($('briefStatus'), '讀取判決中…');
        try {
          var r = await api.brief.run({
            judgmentId: state.briefPick.id,
            focus: $('briefFocus').value.trim(),
            lengthHint: $('briefLength').value,
            fields: fields
          });
          state.brief = r;
          if (r.detail && r.detail.meta && r.detail.meta.title) $('briefPicked').textContent = r.detail.meta.title;
          JR.views.renderBrief(r);
          state.assistHistory.push({ role: 'user', text: '[系統通知] 精讀已完成：' + (r.doc.title || '') + '。段落：' + r.doc.sections.map(function (sec) { return sec.heading + '：' + sec.paragraphs.join(' '); }).join(' ').slice(0, 3000) });
          var an = r.annotated || {};
          JR.setStatus($('briefStatus'), '已完成 AI 整理，已存入「檔案」。' + annotationText(an), an.error ? 'error' : 'ok');
          $('briefExport').disabled = false;
        } catch (err) {
          JR.setStatus($('briefStatus'), '讀取失敗：' + JR.errText(err), 'error');
        } finally {
          $('briefRun').disabled = !state.briefPick;
        }
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
