// 視圖：設定頁的表單（服務類型預設值、身分聯合欄位顯示、精讀欄位列表）。
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
    $('fedFields').hidden = !fed;
    $('keyField').hidden = fed;
    $('setProvider').disabled = fed;
    if (fed) $('setProvider').value = 'anthropic';
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
    JR.views.applyAuthMode();
    $('setProvider').value = s.aiProvider;
    $('setBaseUrl').value = s.aiBaseUrl;
    $('setModel').value = s.aiModel;
    $('keyState').textContent = s.hasKey ? '（已設定）' : '（尚未設定）';
    $('setCacheDays').value = s.cacheDays;
    $('listMax').value = s.defaultMaxItems;
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

  /** 從表單讀出完整設定（包含送出用的欄位）。 */
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
        identityTokenFile: $('setFedFile').value.trim()
      },
      aiBaseUrl: $('setBaseUrl').value.trim(),
      aiModel: $('setModel').value.trim(),
      cacheDays: Number($('setCacheDays').value) || 7
    };
  };
})(window.JR);
