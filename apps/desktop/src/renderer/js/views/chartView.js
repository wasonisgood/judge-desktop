// 視圖：量化圖表頁（工作表與欄位選單、欄位型態覆寫表、圖表結果與警示）。資料由控制器傳入，這裡只負責畫面。
(function (JR) {
  'use strict';
  var el = JR.el;

  var KIND_LABEL = { number: '數值', date: '日期', category: '類別', empty: '空白' };
  var COLUMN_SELECTS = ['chartId', 'chartCategory', 'chartSeries', 'chartValue', 'chartAmount', 'chartFilterCol'];

  /** 型態覆寫選項：「自動」代表沿用推斷結果。 */
  var OVERRIDE_OPTIONS = [['', '自動'], ['number', '數值'], ['date', '日期'], ['category', '類別'], ['empty', '空白']];

  /** 各圖表類型使用的欄位（data-field）與標籤。 */
  var TYPE_FIELDS = {
    bar: { show: ['category', 'series'], category: '類別欄（長條）', series: '分組欄（選填，堆疊）' },
    stacked: { show: ['category', 'series', 'percent'], category: '列欄（例如律師代理）', series: '分段欄（例如終結情形）' },
    violin: { show: ['category', 'value'], category: '分組欄（例如罪名）', value: '數值欄（例如刑期）' },
    crosstab: { show: ['amount', 'category', 'series'], category: '列欄（未選金額欄時使用）', series: '行欄（例如律師代理）' },
    tiles: { show: ['category', 'value'], category: '法院欄', value: '律師代理欄' }
  };

  JR.views.chartTypeFields = function (type) {
    return TYPE_FIELDS[type] || TYPE_FIELDS.bar;
  };

  /** 依圖表類型顯示或隱藏對應欄位，並更新標籤。 */
  JR.views.setChartFields = function (type) {
    var cfg = JR.views.chartTypeFields(type);
    document.querySelectorAll('#page-chart [data-field]').forEach(function (n) {
      n.hidden = cfg.show.indexOf(n.dataset.field) < 0;
    });
    if (cfg.category) JR.$('chartCategoryLabel').textContent = cfg.category;
    if (cfg.series) JR.$('chartSeriesLabel').textContent = cfg.series;
    if (cfg.value) JR.$('chartValueLabel').textContent = cfg.value;
  };

  JR.views.fillChartSheets = function (sheets, selected) {
    var sel = JR.$('chartSheet');
    sel.innerHTML = '';
    sheets.forEach(function (s) {
      sel.appendChild(el('option', '', s.name + '（' + s.rowCount + ' 列）'));
      sel.lastChild.value = s.name;
    });
    sel.value = selected || (sheets[0] && sheets[0].name) || '';
    sel.disabled = sheets.length === 0;
  };

  function fillSelect(id, headers, blankLabel, value) {
    var sel = JR.$(id);
    sel.innerHTML = '';
    sel.appendChild(el('option', '', blankLabel));
    sel.lastChild.value = '';
    headers.forEach(function (h) {
      sel.appendChild(el('option', '', h));
      sel.lastChild.value = h;
    });
    sel.value = value && headers.indexOf(value) >= 0 ? value : '';
  }

  /**
   * 欄位選單與型態覆寫表。suggested 為主程序依欄位名稱給出的預設（只在該欄尚未選取時套用）。
   * overrides 為 { 欄位: 型態 }，由控制器保存；變更時由 onOverride 回呼。
   */
  JR.views.fillChartColumns = function (summary, overrides, suggested, onOverride) {
    var headers = summary.headers;
    var body = JR.$('chartColumns');
    body.innerHTML = '';
    headers.forEach(function (h) {
      var tr = el('tr');
      tr.appendChild(el('td', '', h));
      var inferred = summary.kinds[h];
      tr.appendChild(el('td', '', KIND_LABEL[inferred] || inferred));
      var td = el('td');
      var sel = el('select');
      sel.setAttribute('aria-label', h + ' 的型態覆寫');
      OVERRIDE_OPTIONS.forEach(function (o) {
        var opt = el('option', '', o[1]);
        opt.value = o[0];
        sel.appendChild(opt);
      });
      sel.value = overrides[h] || '';
      sel.addEventListener('change', function () { onOverride(h, sel.value); });
      td.appendChild(sel);
      tr.appendChild(td);
      body.appendChild(tr);
    });
    JR.$('chartColumnsWrap').hidden = headers.length === 0;

    // 其餘欄位的預設依圖表類型由 applyChartDefaults 決定，這裡只清空。
    fillSelect('chartId', headers, '（未選）', (suggested || {}).id);
    fillSelect('chartCategory', headers, '（未選）', '');
    fillSelect('chartSeries', headers, '（未選）', '');
    fillSelect('chartValue', headers, '（未選）', '');
    fillSelect('chartAmount', headers, '（未選）', '');
    fillSelect('chartFilterCol', headers, '（不篩選）', '');
  };

  /** 依圖表類型套用預設欄位。切換類型時覆寫為該類型的預設（各類型用的欄位不同）；沒有預設的欄位保持原樣。 */
  JR.views.applyChartDefaults = function (type, suggested) {
    var s = suggested || {};
    var pick = {
      bar: { chartCategory: s.cause || s.caseType },
      stacked: { chartCategory: s.lawyer, chartSeries: s.outcome },
      violin: { chartCategory: s.charge, chartValue: s.term },
      crosstab: { chartAmount: s.amount, chartSeries: s.lawyer },
      tiles: { chartCategory: s.court, chartValue: s.lawyer }
    }[type] || {};
    // 其餘欄位一律清空，避免切換類型時殘留上一類型的選擇（例如堆疊圖的分段欄留在長條圖）。
    ['chartCategory', 'chartSeries', 'chartValue', 'chartAmount'].forEach(function (id) {
      JR.$(id).value = pick[id] || '';
    });
  };

  /** 圖表結果：交叉表顯示 HTML 表格，其餘顯示 SVG；下方為來源說明。 */
  JR.views.showChartResult = function (res) {
    var box = JR.$('chartOutput');
    box.innerHTML = '';
    if (res.html) {
      var wrap = el('div', 'table-wrap chart-table');
      wrap.innerHTML = res.html;
      box.appendChild(wrap);
    } else {
      var svgBox = el('div', 'chart-svg');
      svgBox.innerHTML = res.svg;
      box.appendChild(svgBox);
    }
    box.appendChild(el('p', 'hint chart-note', res.note));

    var warn = JR.$('chartWarnings');
    warn.innerHTML = '';
    (res.warnings || []).forEach(function (w) { warn.appendChild(el('li', '', w)); });
    warn.hidden = !(res.warnings && res.warnings.length);
  };

  JR.views.clearChartResult = function () {
    JR.$('chartOutput').innerHTML = '';
    JR.$('chartWarnings').hidden = true;
  };

  JR.views.setChartInstalled = function (on) {
    JR.$('chartBody').hidden = !on;
    JR.$('chartOff').hidden = on;
    var rail = document.querySelector('.rail-item[data-page="chart"]');
    if (rail) rail.hidden = !on;
    var box = JR.$('setChartModule');
    if (box) box.checked = on;
  };

  JR.views.chartColumnIds = COLUMN_SELECTS;
})(window.JR);
