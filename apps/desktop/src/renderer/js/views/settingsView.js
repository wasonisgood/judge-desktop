// 視圖：設定頁（服務類型預設值、身分聯合欄位顯示、本地模組開關、管轄區選單、精讀欄位列表）。
(function (JR) {
  'use strict';

  JR.PROVIDER_DEFAULTS = {
    anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
    'openai-compatible': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
  };

  /** 驗證方式切換：身分聯合時顯示聯合欄位、隱藏金鑰欄位，並固定為 Anthropic。 */
  JR.views.applyAuthMode = function () {
    var $ = JR.$;
    var fed = $('setAuthMode').value === 'federation';
    $('fedPanel').hidden = !fed;
    $('keyField').hidden = fed;
    $('setProvider').disabled = fed;
    if (fed) $('setProvider').value = 'anthropic';
    // 身分聯合的欄位在進階區內；切換到聯合時自動展開，讓使用者看得到要填的內容。
    if (fed) JR.controllers.federation.refresh();
    else $('setTest').disabled = false;
  };

  /** 把主程序回傳的設定填入表單。 */
  JR.views.fillSettings = function (s) {
    var $ = JR.$;
    JR.views.renderBriefFields(s.briefFields || []);
    $('setAuthMode').value = s.aiAuthMode || 'apiKey';
    var f = s.federation || {};
    $('setFedOrg').value = f.organizationId || '';
    $('setFedRule').value = f.federationRuleId || '';
    $('setFedSvc').value = f.serviceAccountId || '';
    $('setFedWorkspace').value = f.workspaceId || '';
    $('setFedFile').value = f.identityTokenFile || '';
    $(f.identitySource === 'file' ? 'fedSourceFile' : 'fedSourceProvider').checked = true;
    JR.views.applyAuthMode();
    $('setProvider').value = s.aiProvider;
    $('setBaseUrl').value = s.aiBaseUrl;
    $('setModel').value = s.aiModel;
    $('keyState').textContent = s.hasKey ? '（已設定）' : '（尚未設定）';
    $('setCacheDays').value = s.cacheDays;
    $('setMaxItems').value = s.defaultMaxItems;
    $('listMax').value = s.defaultMaxItems;
    $('setLocalAi').checked = s.localAiEnabled !== false;
  };

  /** 管轄區下拉選單：列出所有已登錄的管轄區，目前預設的選取。各頁的管轄區選單共用同一份清單。 */
  JR.views.fillJurisdictions = function (list, defaultId) {
    var targets = ['setJurisdiction', 'listJurisdiction', 'briefJurisdiction', 'scopeJurisdiction'];
    targets.forEach(function (id) {
      var sel = JR.$(id);
      if (!sel) return;
      var keep = sel.value;
      sel.innerHTML = '';
      (list || []).forEach(function (j) {
        var o = document.createElement('option');
        o.value = j.id;
        o.textContent = j.name + '（' + j.country + '）';
        sel.appendChild(o);
      });
      sel.value = keep && (list || []).some(function (j) { return j.id === keep; }) ? keep : defaultId;
    });
    JR.views.renderJurisdictionNote(defaultId, list);
  };

  /** 說明目前預設管轄區是否支援法規比對（只在範圍整理有差別）。 */
  JR.views.renderJurisdictionNote = function (id, list) {
    var j = (list || []).filter(function (x) { return x.id === id; })[0];
    var note = JR.$('jurisdictionNote');
    if (!note) return;
    note.textContent = j && !j.statuteLookup
      ? '此管轄區不做法規名稱確認與法條比對，範圍整理以輸入的名稱直接搜尋。'
      : '搜尋、精讀與範圍整理預設使用的來源（含法規名稱確認）。';
  };

  /** 服務類型切換：帶入該服務的預設網址與模型。 */
  JR.views.fillProviderDefaults = function () {
    var d = JR.PROVIDER_DEFAULTS[JR.$('setProvider').value];
    JR.$('setBaseUrl').value = d.baseUrl;
    JR.$('setModel').value = d.model;
  };

  JR.views.renderBriefFields = function (list) {
    var box = JR.$('briefFieldList');
    box.innerHTML = '';
    (list || []).forEach(function (f) { box.appendChild(JR.components.briefFieldRow(f)); });
  };

  /** 從表單讀出 AI 服務與預設值（送出用）。 */
  JR.views.readSettingsForm = function () {
    var $ = JR.$;
    return {
      aiProvider: $('setProvider').value,
      aiAuthMode: $('setAuthMode').value,
      federation: {
        organizationId: $('setFedOrg').value.trim(),
        federationRuleId: $('setFedRule').value.trim(),
        serviceAccountId: $('setFedSvc').value.trim(),
        workspaceId: $('setFedWorkspace').value.trim(),
        identityTokenFile: $('setFedFile').value.trim(),
        identitySource: $('fedSourceFile').checked ? 'file' : 'provider'
      },
      aiBaseUrl: $('setBaseUrl').value.trim(),
      aiModel: $('setModel').value.trim(),
      cacheDays: Number($('setCacheDays').value) || 7,
      defaultMaxItems: Number($('setMaxItems').value) || 20
    };
  };
})(window.JR);
