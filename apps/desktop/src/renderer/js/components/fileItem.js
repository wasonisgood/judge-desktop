// 元件：檔案列表的一筆項目（標題、時間、摘要與各種操作按鈕）。操作透過 handlers 交給控制器處理。
(function (JR) {
  'use strict';

  /**
   * @param it 檔案項目
   * @param tab 目前分頁（active / archived / trashed）
   * @param h handlers: open(it), patch(it, patch), remove(it)
   */
  JR.components.fileItem = function (it, tab, h) {
    var el = JR.el;
    var li = el('li', 'file-item');
    var head = el('div', 'file-head');
    head.appendChild(el('span', 'file-kind', JR.KIND_LABEL[it.kind] || it.kind));
    head.appendChild(el('span', 'file-title', (it.starred ? '★ ' : '') + it.title));
    li.appendChild(head);
    li.appendChild(el('p', 'file-meta', JR.fmtTime(it.createdAt) + '　' + it.summary));

    var acts = el('div', 'actions file-actions');
    function btn(label, fn, cls) {
      var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      b.addEventListener('click', fn);
      acts.appendChild(b);
      return b;
    }

    if (tab !== 'trashed') {
      btn('開啟', function () { h.open(it); });
      btn(it.starred ? '取消星號' : '加星號', function () { h.patch(it, { starred: !it.starred }); });
    }
    if (tab === 'active') {
      btn('封存', function () { h.patch(it, { status: 'archived' }); });
      btn('移入垃圾桶', function () { h.patch(it, { status: 'trashed' }); });
    } else if (tab === 'archived') {
      btn('還原', function () { h.patch(it, { status: 'active' }); });
      btn('移入垃圾桶', function () { h.patch(it, { status: 'trashed' }); });
    } else {
      btn('還原', function () { h.patch(it, { status: 'active' }); });
      var del = btn('永久刪除', function () {
        if (del.dataset.armed !== '1') {
          del.dataset.armed = '1';
          del.textContent = '再按一次確認刪除';
          return;
        }
        h.remove(it);
      }, 'danger');
    }
    li.appendChild(acts);
    return li;
  };
})(window.JR);
