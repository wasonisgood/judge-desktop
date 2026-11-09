// 控制器：懸浮 AI 助理（面板開關、全螢幕、對話、可取消、待確認操作的執行與進度卡）。
// v3.6.0：同一時間只處理一則對話；失敗或取消時保留對話紀錄與原文（可重試）；待確認的操作在對應頁忙碌時不重複執行。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;
  var state = JR.state;
  var PAGE = 'assistant';

  var PAGE_LABEL = { scope: '標編碼標注工序', brief: '精讀' };

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
    // 目標頁正在執行時不重複啟動，避免併行（v3.6.0）。
    var target = p.kind === 'run_scope' ? 'scope' : (p.kind === 'run_brief' ? 'brief' : null);
    if (target && JR.jobs.isBusy(target)) {
      JR.components.addMsg('assistant', PAGE_LABEL[target] + '正在執行，請等它完成或取消後，再同意這項操作。');
      return;
    }
    if (p.kind === 'run_scope') {
      JR.components.progressCard('標編碼標注工序進行中', 'scopeStatus', '#scopeProgress .bar');
      JR.nav.showPage('scope');
      $('scopeLines').value = (p.args.statutes || []).join('\n');
      $('scopeKeyword').value = p.args.keyword || '';
      $('scopeRelated').value = p.args.relatedStatute || '';
      $('scopeRelatedOnly').checked = !!p.args.relatedOnly;
      $('scopeSmart').checked = !!p.args.smart;
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
        if (JR.jobs.isBusy(PAGE)) return;
        state.assistHistory = [];
        $('assistLog').innerHTML = '';
      });
      $('assistCancel').addEventListener('click', function () { JR.jobs.cancel(PAGE); });

      $('assistForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var text = $('assistText').value.trim();
        if (!text) return;
        // 上一則還在處理：不送出（Enter 鍵也會經過這裡）。
        if (JR.jobs.isBusy(PAGE)) {
          JR.components.addMsg('assistant', '上一則還在處理中，請等候或按「取消」。');
          return;
        }
        $('assistText').value = '';
        JR.components.addMsg('user', text);
        var thinking = JR.components.addMsg('assistant', '思考中…');
        $('assistSend').disabled = true;
        var runId = JR.jobs.start(PAGE, 'assistCancel');
        try {
          var turn = await api.assistant.chat({ runId: runId, history: state.assistHistory, text: text, searchMode: $('assistMode').value });
          thinking.querySelector('.assist-text').textContent = turn.reply;
          state.assistHistory.push({ role: 'user', text: text });
          state.assistHistory.push({ role: 'assistant', text: turn.reply });
          if (turn.navigate) JR.nav.showPage(turn.navigate);
          (turn.pending || []).forEach(function (p) { JR.components.addPending(p, runPending); });
        } catch (err) {
          var msg = JR.errText(err);
          var cancelled = /已取消/.test(msg);
          thinking.querySelector('.assist-text').textContent = cancelled ? '已取消這一則回覆。' : '無法回應：' + msg + '（你的問題已保留，可修改後再送出。）';
          thinking.classList.toggle('error', !cancelled);
          // 失敗或取消也保留對話紀錄，之後的上下文才會與畫面一致。
          state.assistHistory.push({ role: 'user', text: text });
          state.assistHistory.push({ role: 'assistant', text: cancelled ? '（已取消）' : '（無法回應：' + msg + '）' });
          if (!cancelled) $('assistText').value = text;
        } finally {
          JR.jobs.finish(PAGE);
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
