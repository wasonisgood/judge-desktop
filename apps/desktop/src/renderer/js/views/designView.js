// 視圖：研究設計引導的畫面繪製（只接收資料，不呼叫 IPC）。所有使用者文字一律用 textContent 寫入。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var FIELD_IDS = ['question', 'subject', 'variable', 'yearFrom', 'yearTo', 'statute', 'caseType', 'courtLevel'];
  var STATUS_LABEL = { ok: '通過', warn: '注意', fail: '不足' };

  function renderLog(turns) {
    var log = $('designLog');
    log.textContent = '';
    turns.forEach(function (t) {
      var item = JR.el('div', 'design-turn design-turn-' + t.role);
      item.appendChild(JR.el('div', 'design-turn-who', t.role === 'user' ? '你' : '助理'));
      item.appendChild(JR.el('div', 'design-turn-text', t.text));
      if (t.rationale) item.appendChild(JR.el('div', 'design-turn-why', '理由：' + t.rationale));
      log.appendChild(item);
    });
    log.scrollTop = log.scrollHeight;
  }

  function renderNext(step) {
    var box = $('designNext');
    box.textContent = '';
    var answerBox = $('designAnswer');
    var send = $('designAnswerSend');
    var ai = $('designAiFill');
    if (!step) {
      box.appendChild(JR.el('p', 'design-next-text', '欄位已齊備。請檢視可實證性檢查與建議，再看摘要。'));
      answerBox.disabled = true;
      send.disabled = true;
      ai.disabled = true;
      return;
    }
    box.appendChild(JR.el('p', 'design-next-text', step.prompt));
    box.appendChild(JR.el('p', 'design-next-why', '為什麼問這個：' + step.rationale));
    answerBox.disabled = false;
    send.disabled = false;
    ai.disabled = false;
  }

  function renderChecks(checks) {
    var list = $('designChecks');
    list.textContent = '';
    checks.forEach(function (c) {
      var li = JR.el('li', 'design-check design-check-' + c.status);
      li.appendChild(JR.el('span', 'design-check-badge', STATUS_LABEL[c.status] || c.status));
      li.appendChild(JR.el('span', 'design-check-msg', c.message));
      list.appendChild(li);
    });
  }

  function renderSuggestions(list, handlers) {
    var box = $('designSuggestions');
    box.textContent = '';
    if (!list.length) {
      box.appendChild(JR.el('p', 'hint', '目前沒有需要縮小的建議。'));
      return;
    }
    list.forEach(function (s) {
      var card = JR.el('div', 'design-suggestion');
      card.appendChild(JR.el('p', 'design-suggestion-text', s.text));
      card.appendChild(JR.el('p', 'design-suggestion-why', '理由：' + s.rationale));
      card.appendChild(JR.el('p', 'design-suggestion-cost', '代價：' + s.tradeoff));
      var row = JR.el('div', 'actions');
      var accept = JR.el('button', 'btn primary', '接受');
      accept.type = 'button';
      accept.addEventListener('click', function () { handlers.accept(s.id); });
      var skip = JR.el('button', 'btn', '略過');
      skip.type = 'button';
      skip.addEventListener('click', function () { handlers.skip(s.id); });
      row.appendChild(accept);
      row.appendChild(skip);
      card.appendChild(row);
      box.appendChild(card);
    });
  }

  function fillFields(values) {
    FIELD_IDS.forEach(function (k) {
      var el = $('designF-' + k);
      if (el && values[k] !== undefined && values[k] !== null) el.value = String(values[k]);
    });
  }

  function readFields() {
    var out = {};
    FIELD_IDS.forEach(function (k) {
      var el = $('designF-' + k);
      out[k] = el ? el.value.trim() : '';
    });
    return out;
  }

  function renderSelect(items, currentId) {
    var sel = $('designSelect');
    sel.textContent = '';
    sel.appendChild(new Option(items.length ? '請選擇一筆' : '尚無紀錄', ''));
    items.forEach(function (it) {
      var label = it.title + '（' + JR.fmtTime(it.updatedAt) + '）';
      sel.appendChild(new Option(label, it.id, false, it.id === currentId));
    });
    sel.value = currentId || '';
  }

  JR.views.design = {
    renderSelect: renderSelect,
    showStart: function (on) {
      $('designStartForm').hidden = !on;
      if (on) $('designWork').hidden = true;
    },
    /** 顯示完整的工作畫面（對話、追問、檢查、建議、欄位、摘要）。 */
    renderWork: function (view, handlers) {
      $('designStartForm').hidden = true;
      $('designWork').hidden = false;
      renderLog(view.session.turns);
      renderNext(view.step);
      renderChecks(view.checks);
      renderSuggestions(view.suggestions, handlers);
      fillFields(view.fields);
      $('designSummary').textContent = view.summaryText;
      $('designToScope').disabled = !view.scopeOptions;
      $('designRemove').disabled = false;
    },
    clearWork: function () {
      $('designStartForm').hidden = false;
      $('designWork').hidden = true;
      $('designRemove').disabled = true;
    },
    fillFields: fillFields,
    readFields: readFields
  };
})(window.JR);
