// 控制器：懸浮 AI 助理（面板開關、全螢幕、對話、待確認操作的執行與進度卡）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;

  function setPanel(open) {
    $('assistPanel').hidden = !open;
    $('assistFab').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('assistText').focus();
  }

  // 全螢幕：助理面板撐滿視窗，方便閱讀長篇討論；按 Esc 或再按一次即可還原。
  function setFullscreen(on) {
    $('assistPanel').classList.toggle('fullscreen', on);
    $('assistFull').textContent = on ? '還原' : '全螢幕';
    $('assistFull').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) $('assistText').focus();
  }

  function runPending(p) {
    if (p.kind === 'run_scope') {
      JR.components.progressCard('範圍整理進行中', 'scopeStatus', '#scopeProgress .bar');
      JR.nav.showPage('scope');
      $('scopeLines').value = (p.args.statutes || []).join('\n');
      $('scopeFrom').value = p.args.yearFrom || '';
      $('scopeTo').value = p.args.yearTo || '';
      $('scopeForm').dispatchEvent(new Event('submit', { cancelable: true }));
    } else if (p.kind === 'run_brief') {
      JR.components.progressCard('AI 精讀進行中', 'briefStatus', '#briefView_no_bar');
      JR.nav.showPage('brief');
      JR.controllers.brief.setPick({ id: p.args.judgmentId, title: p.args.judgmentId, dateIso: '' });
      $('briefFocus').value = p.args.focus || '';
      $('briefForm').dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }

  JR.controllers.assistant = {
    bind: function () {
      $('assistFab').addEventListener('click', function () { setPanel($('assistPanel').hidden); });
      $('assistClose').addEventListener('click', function () { setPanel(false); });
      $('assistFull').addEventListener('click', function () { setFullscreen(!$('assistPanel').classList.contains('fullscreen')); });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && $('assistPanel').classList.contains('fullscreen')) setFullscreen(false);
      });
      $('assistClear').addEventListener('click', function () {
        state.assistHistory = [];
        $('assistLog').innerHTML = '';
      });

      $('assistForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var text = $('assistText').value.trim();
        if (!text) return;
        $('assistText').value = '';
        JR.components.addMsg('user', text);
        var thinking = JR.components.addMsg('assistant', '思考中…');
        $('assistSend').disabled = true;
        try {
          var turn = await api.assistant.chat({ history: state.assistHistory, text: text, searchMode: $('assistMode').value });
          thinking.querySelector('.assist-text').textContent = turn.reply;
          state.assistHistory.push({ role: 'user', text: text });
          state.assistHistory.push({ role: 'assistant', text: turn.reply });
          if (turn.navigate) JR.nav.showPage(turn.navigate);
          (turn.pending || []).forEach(function (p) { JR.components.addPending(p, runPending); });
        } catch (err) {
          thinking.querySelector('.assist-text').textContent = '無法回應：' + JR.errText(err);
          thinking.classList.add('error');
        } finally {
          $('assistSend').disabled = false;
        }
      });
      $('assistText').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
          ev.preventDefault();
          $('assistForm').dispatchEvent(new Event('submit', { cancelable: true }));
        }
      });
    }
  };
})(window.JR);
