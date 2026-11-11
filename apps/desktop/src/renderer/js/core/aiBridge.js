// AI 畫面橋接：助理（對話）與畫面之間的唯一通道。
// 1. catalog()：掃描所有頁面中有 id 的欄位與按鈕，送給主程序（見 main/assistantUi.ts）。敏感欄位只給 id，不給值。
// 2. set(id, value)：設定欄位值（立即執行）。敏感欄位與按鈕不能經由這裡設值。
// 3. click(id)：按下按鈕（由使用者同意後才會呼叫）。頁面忙碌（按鈕被鎖定）時拒絕。
// 標示 data-ai-skip 的元素不列入目錄。
(function (JR) {
  'use strict';

  // 與 main/assistantUi.ts 的 SECRET_RE 必須一致（見該檔註解）。
  var SECRET_RE = /secret|token|passw|apikey|api[-_]?key|credential|金鑰|密碼|權杖|^setkey$|^keyfield$/i;

  function pageOf(section) {
    return section.id.replace(/^page-/, '');
  }

  function kindOf(el) {
    var tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag !== 'INPUT') return null;
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'number') return 'number';
    if (el.type === 'button' || el.type === 'submit') return 'button';
    if (el.type === 'file' || el.type === 'hidden') return null;
    return 'text';
  }

  function labelOf(el) {
    var aria = el.getAttribute('aria-label');
    if (aria) return aria;
    var wrap = el.closest ? el.closest('label') : null;
    if (wrap) {
      var span = wrap.querySelector('span');
      if (span && span.textContent.trim()) return span.textContent.trim();
    }
    if (el.tagName === 'BUTTON') return el.textContent.trim() || el.id;
    if (el.placeholder) return el.placeholder;
    return el.id;
  }

  function describe(el, page) {
    var kind = kindOf(el);
    if (!kind) return null;
    var secret = SECRET_RE.test(el.id) || (kind === 'text' && el.type === 'password');
    var c = { id: el.id, page: page, kind: kind, label: labelOf(el), secret: secret };
    if (el.disabled) c.disabled = true;
    if (kind !== 'button' && !secret) {
      c.value = kind === 'checkbox' ? !!el.checked : el.value;
    }
    if (kind === 'select') {
      c.options = Array.prototype.map.call(el.options, function (o) { return o.value; });
    }
    return c;
  }

  function activePage() {
    var active = document.querySelector('.page.active');
    return active ? pageOf(active) : 'home';
  }

  JR.aiBridge = {
    /** 控制項目錄（所有頁面）與目前頁面。隱藏的控制項不列入。 */
    catalog: function () {
      var controls = [];
      document.querySelectorAll('.page').forEach(function (section) {
        var page = pageOf(section);
        section.querySelectorAll('input[id], select[id], textarea[id], button[id]').forEach(function (el) {
          if (el.closest('[data-ai-skip]') || el.closest('[hidden]')) return;
          var c = describe(el, page);
          if (c) controls.push(c);
        });
      });
      return { page: activePage(), controls: controls };
    },

    /** 設定欄位值（立即更新畫面）。回傳 { ok, reason }。 */
    set: function (id, value) {
      var el = document.getElementById(id);
      if (!el) return { ok: false, reason: '找不到控制項「' + id + '」。' };
      if (SECRET_RE.test(id) || el.type === 'password') return { ok: false, reason: '「' + id + '」是敏感欄位，不能由助理填寫。' };
      if (el.tagName === 'BUTTON') return { ok: false, reason: '「' + id + '」是按鈕，不能設定值。' };
      if (el.disabled) return { ok: false, reason: '「' + labelOf(el) + '」目前是停用狀態。' };
      if (el.type === 'checkbox') {
        el.checked = value === true || value === 'true';
      } else {
        el.value = String(value);
        if (el.tagName === 'SELECT' && el.value !== String(value)) return { ok: false, reason: '「' + labelOf(el) + '」沒有這個選項。' };
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    },

    /** 頁面動作（ui_action）：由主程序驗證過的參數，分派給對應的控制器。回傳 { ok, reason }。 */
    runAction: function (name, args) {
      try {
        if (name === 'pickCandidate') return JR.controllers.brief.pickById(args.id);
        if (name === 'setCriteria') return JR.controllers.criteria.setRows(args.criteria);
        if (name === 'addScopeField') return JR.controllers.scope.addField(args);
        if (name === 'removeScopeField') return JR.controllers.scope.removeField(args.name);
        if (name === 'briefFromList') {
          var item = (JR.state.listItems || []).filter(function (x) { return x.id === args.id; })[0];
          if (!item) return { ok: false, reason: '判決列表中沒有這則判決，請先搜尋或匯入。' };
          JR.controllers.brief.openFromList(item, JR.state.listItems);
          return { ok: true };
        }
        if (name === 'semanticExpand') {
          var btn = document.querySelector('#page-semantic [data-expand-id="' + String(args.caseId).replace(/"/g, '\\"') + '"]');
          if (!btn) return { ok: false, reason: '結果中找不到這則判決，請先執行段落檢索。' };
          if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
          return { ok: true };
        }
        if (name === 'scopeReview') return JR.controllers.scope.review(args);
        if (name === 'scopeOpenSource') { JR.controllers.scope.openSource(args.caseId, args.quote); return { ok: true }; }
        if (name === 'annotateQuote') return JR.controllers.annotation.annotateQuote(args.quote, args.color, args.note);
        return { ok: false, reason: '不支援的畫面操作：' + name };
      } catch (err) {
        return { ok: false, reason: '操作失敗：' + (err && err.message ? err.message : String(err)) };
      }
    },

    /** 按下按鈕。頁面正在處理（按鈕被鎖定）時拒絕，避免重複送出。 */
    click: function (id) {
      var el = document.getElementById(id);
      if (!el || el.tagName !== 'BUTTON') return { ok: false, reason: '找不到按鈕「' + id + '」。' };
      if (el.inert) return { ok: false, reason: '「' + labelOf(el) + '」所在的頁面正在處理中，請等候完成後再按。' };
      if (el.disabled) return { ok: false, reason: '「' + labelOf(el) + '」目前是停用狀態。' };
      el.click();
      return { ok: true };
    }
  };
})(window.JR);
