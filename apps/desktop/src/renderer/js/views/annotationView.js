// 視圖：個案研究筆記（全文螢光區段、註解列表、編輯面板、需重新對位列表、浮動工具列）。
(function (JR) {
  'use strict';

  var COLORS = ['yellow', 'green', 'pink', 'blue'];

  /** 全文：依區段（已由主程序切好）畫出螢光；每段帶 data-s（起始位置）供選取換算。 */
  JR.views.renderAnnReader = function (view) {
    var box = JR.$('annReader');
    box.innerHTML = '';
    view.segments.forEach(function (seg) {
      var span = seg.color ? JR.el('mark', 'ann ann-' + seg.color) : JR.el('span');
      if (seg.color) span.setAttribute('data-ann', seg.annotationIds.join(' '));
      span.setAttribute('data-s', String(seg.start));
      span.textContent = view.fullText.slice(seg.start, seg.end);
      box.appendChild(span);
    });
    if (!view.segments.length) box.appendChild(JR.el('p', 'hint', '判決全文為空。'));
  };

  function excerpt(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /** 右欄：有註解文字的標注，依位置排序；點選跳回原文並開啟編輯。 */
  JR.views.renderAnnNotes = function (view, onPick) {
    var list = JR.$('annNotes');
    list.innerHTML = '';
    var labels = view.colorLabels;
    var notes = view.annotations
      .filter(function (a) { return a.status === 'ok' && a.mode === 'highlight_note' && a.note && (view.includeAi || a.origin !== 'ai'); })
      .sort(function (x, y) { return x.start - y.start; });
    JR.$('annNoteCount').textContent = notes.length ? '（' + notes.length + '）' : '';
    if (!notes.length) list.appendChild(JR.el('li', 'hint', '尚未建立註解。在全文選取文字，選「螢光並做筆記」即可新增。'));
    notes.forEach(function (a) {
      var li = JR.el('li', 'ann-note-item ann-' + a.color);
      var btn = JR.el('button', 'ann-note-btn');
      btn.type = 'button';
      btn.appendChild(JR.el('span', 'ann-tag', labels[a.color] + (a.origin === 'ai' ? '・AI' : '')));
      btn.appendChild(JR.el('span', 'ann-quote', '「' + excerpt(a.quote, 40) + '」'));
      btn.appendChild(JR.el('span', 'ann-note-text', a.note));
      btn.addEventListener('click', function () { onPick(a.id); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  };

  /** 需重新對位：全文變動後無法確定位置的標注，不在原文中顯示。 */
  JR.views.renderAnnReanchor = function (view, onReanchor, onRemove) {
    var box = JR.$('annReanchorBox');
    var list = JR.$('annReanchor');
    var stale = view.annotations.filter(function (a) { return a.status !== 'ok'; });
    box.hidden = stale.length === 0;
    list.innerHTML = '';
    stale.forEach(function (a) {
      var li = JR.el('li', 'ann-note-item');
      li.appendChild(JR.el('span', 'ann-tag', view.colorLabels[a.color]));
      li.appendChild(JR.el('span', 'ann-quote', '「' + excerpt(a.quote, 40) + '」'));
      if (a.note) li.appendChild(JR.el('span', 'ann-note-text', a.note));
      var re = JR.el('button', 'btn small', '嘗試重新對位');
      re.type = 'button';
      re.addEventListener('click', function () { onReanchor(a.id); });
      var rm = JR.el('button', 'btn small danger', '刪除');
      rm.type = 'button';
      rm.addEventListener('click', function () { onRemove(a.id); });
      li.appendChild(re);
      li.appendChild(rm);
      list.appendChild(li);
    });
  };

  /** 編輯面板：顏色、模式、註解文字。ann 為 null 時隱藏。 */
  JR.views.renderAnnEditor = function (view, ann, handlers) {
    var box = JR.$('annEditor');
    box.innerHTML = '';
    box.hidden = !ann;
    if (!ann) return;
    var labels = view.colorLabels;
    box.appendChild(JR.el('h3', '', '編輯標注' + (ann.origin === 'ai' ? '（AI 引文）' : '')));
    box.appendChild(JR.el('p', 'ann-quote-full', '「' + ann.quote + '」'));

    var colorField = JR.el('label', 'field');
    colorField.appendChild(JR.el('span', '', '顏色'));
    var sel = JR.el('select');
    sel.id = 'annEditColor';
    COLORS.forEach(function (c) {
      var o = JR.el('option', '', labels[c]);
      o.value = c;
      if (c === ann.color) o.selected = true;
      sel.appendChild(o);
    });
    colorField.appendChild(sel);
    box.appendChild(colorField);

    var modeRow = JR.el('div', 'ann-modes');
    var modes = [['highlight', '只畫螢光'], ['highlight_note', '螢光並做筆記']];
    var currentMode = ann.mode;
    modes.forEach(function (m) {
      var b = JR.el('button', 'btn small', m[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(m[0] === currentMode));
      b.classList.toggle('primary', m[0] === currentMode);
      b.addEventListener('click', function () {
        currentMode = m[0];
        Array.prototype.forEach.call(modeRow.children, function (x) {
          var on = x === b;
          x.setAttribute('aria-pressed', String(on));
          x.classList.toggle('primary', on);
        });
        noteField.hidden = currentMode !== 'highlight_note';
      });
      modeRow.appendChild(b);
    });
    box.appendChild(modeRow);

    var noteField = JR.el('label', 'field');
    noteField.hidden = currentMode !== 'highlight_note';
    noteField.appendChild(JR.el('span', '', '註解（單句，選填）'));
    var ta = JR.el('textarea');
    ta.id = 'annEditNote';
    ta.rows = 4;
    ta.maxLength = 2000;
    ta.value = ann.note || '';
    noteField.appendChild(ta);
    box.appendChild(noteField);

    var actions = JR.el('div', 'actions');
    var save = JR.el('button', 'btn primary small', '儲存');
    save.type = 'button';
    save.addEventListener('click', function () {
      handlers.save(ann.id, { color: sel.value, mode: currentMode, note: ta.value });
    });
    var del = JR.el('button', 'btn danger small', '刪除標注');
    del.type = 'button';
    del.addEventListener('click', function () { handlers.remove(ann.id); });
    var close = JR.el('button', 'btn small', '關閉');
    close.type = 'button';
    close.addEventListener('click', function () { handlers.close(); });
    actions.appendChild(save);
    actions.appendChild(del);
    actions.appendChild(close);
    box.appendChild(actions);
    if (currentMode === 'highlight_note') setTimeout(function () { ta.focus(); }, 0);
  };

  /** 過去筆記列表：點選切換案件；勾選者用於合併匯出。 */
  JR.views.renderAnnPast = function (list, targetId, checked, onPick, onToggle) {
    var ul = JR.$('annPastList');
    ul.innerHTML = '';
    JR.$('annPastCount').textContent = list.length ? '（' + list.length + ' 案）' : '';
    if (!list.length) ul.appendChild(JR.el('li', 'hint', '尚無筆記的案件。'));
    list.forEach(function (r) {
      var li = JR.el('li', 'ann-past-item' + (r.judgmentId === targetId ? ' is-current' : ''));
      var cb = JR.el('input');
      cb.type = 'checkbox';
      cb.checked = !!checked[r.judgmentId];
      cb.setAttribute('aria-label', '納入合併匯出');
      cb.addEventListener('change', function () { onToggle(r.judgmentId, cb.checked); });
      var btn = JR.el('button', 'ann-note-btn');
      btn.type = 'button';
      btn.appendChild(JR.el('span', 'ann-quote', r.meta.title));
      btn.appendChild(JR.el('span', 'ann-tag', r.count + ' 筆標注'));
      btn.addEventListener('click', function () { onPick(r.judgmentId); });
      li.appendChild(cb);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  };

  /** 逐案閱讀導覽列：nav 為 null 時隱藏。 */
  JR.views.renderAnnNav = function (nav) {
    var box = JR.$('annNav');
    box.hidden = !nav;
    if (!nav) return;
    JR.$('annNavText').textContent = '逐案閱讀：第 ' + (nav.index + 1) + ' / ' + nav.total + ' 案　' + nav.title;
    JR.$('annPrev').disabled = nav.index <= 0;
    JR.$('annNext').disabled = nav.index >= nav.total - 1;
  };

  /** 顏色名稱編輯欄位。 */
  JR.views.renderAnnLabels = function (labels) {
    ['yellow', 'green', 'pink', 'blue'].forEach(function (c) { JR.$('annLabel-' + c).value = labels[c] || ''; });
  };

  /** 浮動工具列：定位在選取範圍上方（相對於標注區塊）。 */
  JR.views.showAnnToolbar = function (rect, containerRect, mode) {
    var tb = JR.$('annToolbar');
    tb.hidden = false;
    var left = rect.left - containerRect.left + rect.width / 2 - 140;
    tb.style.left = Math.max(0, left) + 'px';
    tb.style.top = Math.max(0, rect.top - containerRect.top - 46) + 'px';
    Array.prototype.forEach.call(tb.querySelectorAll('[data-mode]'), function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('primary', on);
    });
  };

  JR.views.hideAnnToolbar = function () {
    JR.$('annToolbar').hidden = true;
  };
})(window.JR);
