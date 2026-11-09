// 元件：處理流程說明視窗（issue #4 第 7 點）。內容由主程序的流程紀錄產生，全部以 textContent 寫入，不解譯 HTML。
// 有 flow（流程節點）時，沿用工作負載身分聯盟引導面板（fedPanel）的呈現：一排編號步驟、目前步驟標示、
// 每一步的完成／失敗／略過圖示，以及上一步、下一步。沒有 flow 時維持原本的文字清單（其他頁面使用）。
// 回傳 { update(explanation), close() }：執行中可以用 update 即時換成新的流程狀態。
(function (JR) {
  'use strict';

  var ROMAN = ['一', '二', '三', '四', '五', '六', '七', '八'];
  var SVG = {
    ok: '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    no: '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    skip: '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    run: '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>',
    idle: '<svg class="fed-tick" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
  };
  // 狀態的文字與圖示（與 core scopeFlow 的 FlowStatus 一致）。
  var STATUS = {
    pending: { text: '未開始', icon: 'idle' },
    running: { text: '進行中', icon: 'run' },
    done: { text: '完成', icon: 'ok' },
    failed: { text: '失敗（已回退）', icon: 'no' },
    skipped: { text: '略過', icon: 'skip' },
    waiting: { text: '等待選擇', icon: 'run' }
  };
  var HINT = {
    pending: '尚未執行到這一步。',
    running: '正在執行這一步，完成後會顯示處理紀錄。',
    skipped: '依目前的選項，這一步不會執行。',
    waiting: '需要您在輸入欄位選擇後，才能繼續。',
    failed: '這一步失敗，流程已回退並繼續，結果以目前能取得的資料為準。'
  };

  function el(tag, cls, text) { return JR.el(tag, cls, text); }

  function initialIndex(flow) {
    var i = flow.findIndex(function (n) { return n.status === 'running'; });
    if (i >= 0) return i;
    i = flow.findIndex(function (n) { return n.status === 'pending' || n.status === 'waiting'; });
    return i >= 0 ? i : flow.length - 1;
  }

  JR.components.explainDialog = function (explanation) {
    var old = document.getElementById('explainOverlay');
    if (old) old.parentNode.removeChild(old);

    var overlay = el('div', 'explain-overlay');
    overlay.id = 'explainOverlay';
    var box = el('div', 'explain-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    var h = el('h2', '', (explanation && explanation.title) || '處理流程說明');
    box.appendChild(h);
    var body = el('div', 'explain-body');
    box.appendChild(body);
    var close = el('button', 'btn primary', '關閉');
    close.type = 'button';
    close.addEventListener('click', closeIt);
    box.appendChild(close);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeIt(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);

    var current = explanation || {};
    var selected = -1;

    function renderParagraphs() {
      var list = el('ol', 'explain-steps');
      var paragraphs = current.paragraphs || [];
      if (paragraphs.length === 0) list.appendChild(el('li', '', '沒有可說明的處理步驟。'));
      paragraphs.forEach(function (text) { list.appendChild(el('li', '', text)); });
      body.appendChild(list);
    }

    function renderFlow(flow) {
      if (selected < 0 || selected >= flow.length || (selected === -1)) selected = initialIndex(flow);
      var bar = el('ol', 'fed-steps scope-steps');
      bar.setAttribute('aria-label', '處理流程');
      flow.forEach(function (n, i) {
        var st = STATUS[n.status] || STATUS.pending;
        var li = el('li');
        var btn = el('button', 'fed-step-btn scope-step-btn ' + n.status);
        btn.type = 'button';
        btn.setAttribute('data-step', String(i));
        if (i === selected) { btn.classList.add('active'); btn.setAttribute('aria-current', 'step'); }
        btn.innerHTML = '<span class="fed-step-no">' + (ROMAN[i] || String(i + 1)) + '</span>';
        btn.appendChild(el('span', 'fed-step-name', n.label));
        var state = el('span', 'scope-step-state');
        state.innerHTML = SVG[st.icon] + '<span>' + st.text + '</span>';
        btn.appendChild(state);
        btn.addEventListener('click', function () { selected = i; render(); });
        li.appendChild(btn);
        bar.appendChild(li);
      });
      body.appendChild(bar);

      var node = flow[selected];
      var sec = el('section', 'fed-step-body scope-step-body');
      sec.appendChild(el('h4', '', ROMAN[selected] + '、' + node.label));
      var lines = node.lines || [];
      if (lines.length) {
        lines.forEach(function (text) { sec.appendChild(el('p', '', text)); });
      } else {
        sec.appendChild(el('p', 'hint', HINT[node.status] || ''));
      }
      if (node.detail && node.status !== 'pending') sec.appendChild(el('p', 'hint', '結果：' + node.detail));
      body.appendChild(sec);

      var nav = el('div', 'fed-nav');
      var prev = el('button', 'btn', '上一步');
      prev.type = 'button';
      prev.disabled = selected === 0;
      prev.addEventListener('click', function () { selected = Math.max(0, selected - 1); render(); });
      var next = el('button', 'btn', '下一步');
      next.type = 'button';
      next.disabled = selected === flow.length - 1;
      next.addEventListener('click', function () { selected = Math.min(flow.length - 1, selected + 1); render(); });
      nav.appendChild(prev);
      nav.appendChild(next);
      body.appendChild(nav);
    }

    function render() {
      body.innerHTML = '';
      if (current.flow && current.flow.length) {
        renderFlow(current.flow);
        if (current.paragraphs && current.paragraphs.length) {
          body.appendChild(el('p', 'hint', current.paragraphs[current.paragraphs.length - 1]));
        }
      } else {
        renderParagraphs();
      }
    }

    function update(next) {
      if (!next) return;
      current = Object.assign({}, current, next);
      selected = -1; // 即時更新時跟著目前執行的步驟
      if (!overlay.parentNode) return;
      if (current.title) h.textContent = current.title;
      render();
    }

    function onKey(ev) { if (ev.key === 'Escape') closeIt(); }
    function closeIt() {
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    render();
    close.focus();
    return { update: update, close: closeIt };
  };
})(window.JR);
