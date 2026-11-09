// 視圖：段落檢索結果（依案號分組、段落原文、AI 評分與依據、展開全文）與結果內小助手的對話紀錄。
// 分數一律標示為「AI 評分」；回退時標示為關鍵字覆蓋（非語意），並顯示 notice。
(function (JR) {
  'use strict';
  var el = JR.el;

  var KIND_NAME = { fact: '法律事實', opinion: '法官見解' };
  var SORT_NOTE = 'AI 評分，非向量相似度。';

  function scoreText(hit, source) {
    if (source === 'ai') return 'AI 評分 ' + hit.score.toFixed(2);
    return '關鍵字覆蓋 ' + hit.score.toFixed(2) + '（回退，非語意）';
  }

  JR.views.renderSemanticSummary = function (run, sort, kind) {
    var summary = JR.$('semSummary');
    var note = JR.$('semScoreNote');
    var notice = JR.$('semNotice');
    summary.hidden = false;
    if (run.scoreSource === 'ai') {
      note.textContent = SORT_NOTE + '（' + KIND_NAME[kind] + '段落，依 AI 評分' + (sort === 'caseNo' ? '，目前以案號排列' : '') + '）';
    } else {
      note.textContent = '目前為關鍵字回退結果：分數是關鍵字覆蓋率，不是 AI 評分，也不是向量相似度。';
    }
    if (run.notice) {
      notice.textContent = run.notice;
      notice.hidden = false;
    } else {
      notice.textContent = '';
      notice.hidden = true;
    }
  };

  /**
   * 依案號分組顯示。onExpand(caseId, box, button) 由控制器提供，負責載入全文。
   */
  JR.views.renderSemanticResult = function (groups, run, onExpand) {
    var box = JR.$('semResult');
    box.innerHTML = '';
    if (!groups.length) {
      box.appendChild(el('p', 'hint', run.cancelled ? '已取消，尚未完成排序。' : '沒有找到含有相關段落的判決。可以換關鍵字、放寬篩選，或改寫研究問題。'));
      return;
    }
    groups.forEach(function (g, i) {
      var src = (run.sources && run.sources[g.caseId]) || {};
      var card = el('div', 'semantic-case');
      var head = el('div', 'semantic-case-head');
      head.appendChild(el('span', 'num', String(i + 1) + '.'));
      head.appendChild(el('h3', '', g.caseNo ? g.caseNo : (src.title || g.caseId)));
      head.appendChild(el('span', 'semantic-badge', (run.scoreSource === 'ai' ? '最高 AI 評分 ' : '最高覆蓋 ') + g.best.toFixed(2)));
      card.appendChild(head);
      var meta = [src.court, g.dateIso, src.title].filter(Boolean).join('　');
      card.appendChild(el('p', 'hint semantic-source', meta));
      if (src.href) card.appendChild(el('p', 'hint semantic-source', '來源：' + src.href));

      var list = el('ul', 'semantic-passages');
      g.hits.forEach(function (h) {
        var li = el('li', 'semantic-passage');
        li.appendChild(el('p', 'semantic-text', h.passageText));
        li.appendChild(el('p', 'hint', KIND_NAME[h.kind] + '段落｜' + scoreText(h, run.scoreSource)));
        if (h.basis) li.appendChild(el('p', 'semantic-basis', '依據：' + h.basis));
        if (h.quote) li.appendChild(el('p', 'semantic-quote', '引文（已在判決原文中逐字核對）：「' + h.quote + '」'));
        list.appendChild(li);
      });
      card.appendChild(list);

      var full = el('div', 'semantic-fulltext');
      full.hidden = true;
      var btn = el('button', 'btn small', '展開全文');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () {
        var open = full.hidden;
        if (open && !full.dataset.loaded) {
          onExpand(g.caseId, full, btn);
        }
        full.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? '收起全文' : '展開全文';
      });
      var row = el('div', 'actions');
      row.appendChild(btn);
      card.appendChild(row);
      card.appendChild(full);
      box.appendChild(card);
    });
  };

  /** 小助手對話紀錄。entry：{role:'user'|'assistant'|'error', text, check?, omitted?}。 */
  JR.views.renderSemanticChat = function (entries) {
    var log = JR.$('semLog');
    log.innerHTML = '';
    entries.forEach(function (en) {
      var m = el('div', 'assist-msg ' + (en.role === 'user' ? 'user' : en.role === 'error' ? 'error' : 'assistant'));
      m.appendChild(el('div', 'assist-who', en.role === 'user' ? '您' : '助理'));
      if (en.role === 'assistant' && en.check && en.check.status !== 'ok') {
        var warn = el('div', 'semantic-notice', '警告：' + en.check.message + '以下內容未通過結果集檢查，不可作為結論。');
        m.appendChild(warn);
        m.appendChild(el('div', 'assist-text semantic-untrusted', en.text));
      } else {
        m.appendChild(el('div', 'assist-text', en.text));
      }
      if (en.omitted) m.appendChild(el('p', 'hint', '另有 ' + en.omitted + ' 件因篇幅限制未列入小助手的範圍。'));
      log.appendChild(m);
    });
    log.scrollTop = log.scrollHeight;
  };
})(window.JR);
