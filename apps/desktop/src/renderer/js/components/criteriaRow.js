// 元件：核查標準的一列（納入／排除、描述、判斷方式、關鍵字與全部／任一、移除）。讀值用 row.readCriterion()。
(function (JR) {
  'use strict';

  function option(sel, value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
    return o;
  }

  JR.components.criteriaRow = function (c) {
    var el = JR.el;
    var row = el('div', 'crit-row');
    var kind = el('select', 'crit-kind');
    kind.setAttribute('aria-label', '標準類型');
    option(kind, 'include', '納入');
    option(kind, 'exclude', '排除');
    kind.value = c.kind === 'exclude' ? 'exclude' : 'include';

    var text = el('input', 'crit-text');
    text.type = 'text';
    text.placeholder = '標準，例如：原告為消費者';
    text.setAttribute('aria-label', '標準描述');
    text.value = c.text || '';

    var method = el('select', 'crit-method');
    method.setAttribute('aria-label', '判斷方式');
    option(method, 'ai', 'AI 判斷（標準查核）');
    method.title = 'AI 依此標準逐案判斷符合、不符合或無法判斷，依據必須逐字存在於判決原文';
    option(method, 'program', '程式判斷（關鍵字）');
    method.value = c.method === 'program' ? 'program' : 'ai';

    var kw = el('input', 'crit-kw');
    kw.type = 'text';
    kw.placeholder = '關鍵字，以頓號或逗號分隔';
    kw.setAttribute('aria-label', '關鍵字');
    kw.value = (c.keywords || []).join('、');

    var mode = el('select', 'crit-mode');
    mode.setAttribute('aria-label', '關鍵字比對方式');
    option(mode, 'any', '任一出現');
    option(mode, 'all', '全部出現');
    mode.value = c.keywordMode === 'all' ? 'all' : 'any';

    var del = el('button', 'btn small', '移除');
    del.type = 'button';

    function syncMethod() {
      var prog = method.value === 'program';
      kw.hidden = !prog;
      mode.hidden = !prog;
    }
    method.addEventListener('change', syncMethod);
    syncMethod();

    del.addEventListener('click', function () {
      var box = row.parentNode;
      row.remove();
      // 讓上層知道標準已變更（使執行前規劃失效）。
      if (box) box.dispatchEvent(new Event('change', { bubbles: true }));
    });

    [kind, text, method, kw, mode, del].forEach(function (x) { row.appendChild(x); });
    row.readCriterion = function () {
      return { kind: kind.value, text: text.value, method: method.value, keywords: kw.value, keywordMode: mode.value };
    };
    return row;
  };
})(window.JR);
