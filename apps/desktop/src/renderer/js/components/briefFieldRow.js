// 元件：精讀欄位的一列（勾選、欄位名稱、說明、移除）。
(function (JR) {
  'use strict';

  JR.components.briefFieldRow = function (f) {
    var el = JR.el;
    var row = el('div', 'brief-field-row');
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
    desc.placeholder = '說明（選填）：AI 會依此整理這個欄位';
    desc.value = f.description || '';
    var del = el('button', 'btn small', '移除');
    del.type = 'button';
    del.addEventListener('click', function () { row.remove(); });
    row.appendChild(cb);
    row.appendChild(name);
    row.appendChild(desc);
    row.appendChild(del);
    return row;
  };
})(window.JR);
