// 視圖：單一判決（已選定的判決、候選列表、精讀結果與原判決主文）。
(function (JR) {
  'use strict';

  /** 更新「已選定」列與精讀按鈕（狀態由控制器寫入 JR.state.briefPick）。 */
  JR.views.renderPick = function (item) {
    JR.$('briefPicked').textContent = item ? (item.title + (item.dateIso || item.dateDisplay ? '（' + (item.dateIso || item.dateDisplay) + '）' : '')) : '尚未選定';
    JR.$('briefRun').disabled = !item;
  };

  /** 候選列表；onPick(it, tr) 由控制器處理選定。 */
  JR.views.renderCandidates = function (items, onPick) {
    var el = JR.el;
    var body = JR.$('briefCandidateBody');
    body.innerHTML = '';
    items.forEach(function (it, i) {
      var tr = el('tr');
      [String(i + 1), it.title, it.dateIso || it.dateDisplay || '', it.cause || ''].forEach(function (text, j) {
        tr.appendChild(el('td', j === 0 ? 'num' : (j === 2 ? 'nowrap' : ''), text));
      });
      var td = el('td');
      var pick = el('button', 'btn small', '選定這則');
      pick.type = 'button';
      pick.addEventListener('click', function () { onPick(it, tr); });
      td.appendChild(pick);
      tr.appendChild(td);
      body.appendChild(tr);
    });
    JR.$('briefCandidates').hidden = items.length === 0;
  };

  /** 精讀結果：標題、基本資料、各段落，與原判決主文（螢光標示）。 */
  JR.views.renderBrief = function (view) {
    var el = JR.el;
    var d = view.detail;
    var doc = view.doc;
    var box = JR.$('briefView');
    box.innerHTML = '';
    box.appendChild(el('h2', '', doc.title || d.meta.title || d.meta.id));
    box.appendChild(el('p', '', '法院：' + (d.meta.court || '—') + '　日期：' + (d.meta.dateIso || d.meta.dateMinguo || '—') + '　案由：' + (d.meta.cause || '—')));
    box.appendChild(el('p', '', '歷審：' + (d.historyPosition ? d.historyPosition.summary : '未取得')));
    doc.sections.forEach(function (sec) {
      box.appendChild(el('h3', '', sec.heading));
      sec.paragraphs.forEach(function (text) { box.appendChild(el('p', '', text)); });
    });
    box.appendChild(el('h3', '', '原判決主文'));
    (d.sections['主文'] || '').split(/\n+/).filter(Boolean).forEach(function (line) {
      var p = el('p');
      p.appendChild(el('mark', '', line));
      box.appendChild(p);
    });
    box.hidden = false;
  };
})(window.JR);
