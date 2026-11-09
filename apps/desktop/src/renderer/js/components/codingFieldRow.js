// 元件：標編碼標注工序的分析欄位一列（勾選、名稱、說明、上移、下移、移除）。樣式沿用精讀欄位列。
(function (JR) {
  'use strict';

  JR.components.codingFieldRow = function (f) {
    var el = JR.el;
    var row = el('div', 'brief-field-row coding-field-row');
    row.dataset.fieldId = f.id || '';
    var cb = el('input');
    cb.type = 'checkbox';
    cb.checked = f.enabled !== false;
    cb.className = 'brief-field-on';
    var name = el('input', 'brief-field-name');
    name.type = 'text';
    name.placeholder = '欄位名稱，例如：原告請求的金額';
    name.value = f.name || '';
    var desc = el('input', 'brief-field-desc');
    desc.type = 'text';
    desc.placeholder = '說明（選填）：AI 會依此編碼這個欄位';
    desc.value = f.description || '';
    var actions = el('div', 'coding-field-actions');
    var up = el('button', 'btn small', '上移');
    up.type = 'button';
    up.addEventListener('click', function () {
      var prev = row.previousElementSibling;
      if (prev) row.parentNode.insertBefore(row, prev);
    });
    var down = el('button', 'btn small', '下移');
    down.type = 'button';
    down.addEventListener('click', function () {
      var next = row.nextElementSibling;
      if (next) row.parentNode.insertBefore(next, row);
    });
    var del = el('button', 'btn small', '移除');
    del.type = 'button';
    del.addEventListener('click', function () { row.remove(); });
    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(del);
    row.appendChild(cb);
    row.appendChild(name);
    row.appendChild(desc);
    row.appendChild(actions);
    return row;
  };
})(window.JR);
