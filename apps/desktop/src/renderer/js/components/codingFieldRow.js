// 元件：標編碼標注工序的分析欄位表格列（欄位名稱、說明、納入、排序、操作）。
// 操作欄的按鈕以 data-action 標示（up、down、rename、remove），由控制器依前置條件停用。
(function (JR) {
  'use strict';

  function actionBtn(action, label) {
    var b = JR.el('button', 'btn small', label);
    b.type = 'button';
    b.setAttribute('data-action', action);
    return b;
  }

  JR.components.codingFieldRow = function (f) {
    var el = JR.el;
    var row = el('tr', 'coding-field-row');
    row.dataset.fieldId = f.id || '';

    var nameCell = el('td');
    var name = el('input', 'brief-field-name');
    name.type = 'text';
    name.placeholder = '欄位名稱，例如：原告請求的金額';
    name.setAttribute('aria-label', '欄位名稱');
    name.value = f.name || '';
    nameCell.appendChild(name);

    var descCell = el('td');
    var desc = el('input', 'brief-field-desc');
    desc.type = 'text';
    desc.placeholder = '說明（選填）：AI 會依此編碼這個欄位';
    desc.setAttribute('aria-label', '說明');
    desc.value = f.description || '';
    descCell.appendChild(desc);

    var onCell = el('td', 'scope-col-on');
    var cb = el('input', 'brief-field-on');
    cb.type = 'checkbox';
    cb.checked = f.enabled !== false;
    cb.setAttribute('aria-label', '納入編碼');
    onCell.appendChild(cb);

    var orderCell = el('td', 'scope-col-order scope-order');

    var opsCell = el('td', 'scope-col-ops');
    var actions = el('div', 'coding-field-actions');
    actions.appendChild(actionBtn('up', '上移'));
    actions.appendChild(actionBtn('down', '下移'));
    actions.appendChild(actionBtn('rename', '改名'));
    actions.appendChild(actionBtn('remove', '移除'));
    opsCell.appendChild(actions);

    // 上移、下移：調整列的位置；改名：把焦點移到名稱欄；移除：刪除列。
    actions.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (action === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      if (action === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      if (action === 'rename') name.focus();
      if (action === 'remove') row.remove();
    });

    row.appendChild(nameCell);
    row.appendChild(descCell);
    row.appendChild(onCell);
    row.appendChild(orderCell);
    row.appendChild(opsCell);
    return row;
  };
})(window.JR);
