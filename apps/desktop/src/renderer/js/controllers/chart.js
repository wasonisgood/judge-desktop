// 控制器：量化圖表頁（issue #8）。選檔、選工作表與欄位、繪製，以及 PNG／SVG 匯出；模組開關也在這裡。
// PNG：把主程序給的 SVG 畫到 canvas 再 toDataURL；SVG 直接存檔（由主程序寫入匯出資料夾）。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var api = window.api;

  var st = { filePath: null, sheets: [], overrides: {}, result: null };

  function setStatus(msg, kind) { JR.setStatus($('chartStatus'), msg, kind); }

  function setResultReady(on) {
    $('chartPng').disabled = !on;
    $('chartSvg').disabled = !on;
  }

  function currentSummary() {
    var name = $('chartSheet').value;
    for (var i = 0; i < st.sheets.length; i++) if (st.sheets[i].name === name) return st.sheets[i];
    return null;
  }

  function collectConfig() {
    var type = $('chartType').value;
    var show = JR.views.chartTypeFields(type).show;
    var pick = function (id) { return $(id).value || null; };
    var only = function (field, id) { return show.indexOf(field) >= 0 ? pick(id) : null; };
    var filters = {};
    var fc = pick('chartFilterCol');
    var vals = $('chartFilterVals').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (fc && vals.length) filters[fc] = vals;
    return {
      type: type,
      unit: $('chartUnit').value,
      title: $('chartTitle').value.trim(),
      idColumn: pick('chartId'),
      category: only('category', 'chartCategory'),
      series: only('series', 'chartSeries'),
      value: only('value', 'chartValue'),
      amount: only('amount', 'chartAmount'),
      percent: show.indexOf('percent') >= 0 && $('chartPercent').checked,
      filters: filters,
      kindOverrides: st.overrides
    };
  }

  function selectSheet() {
    var summary = currentSummary();
    if (!summary) return;
    st.overrides = {};
    st.result = null;
    setResultReady(false);
    JR.views.clearChartResult();
    JR.views.fillChartColumns(summary, st.overrides, summary.suggested, function (col, kind) {
      if (kind) st.overrides[col] = kind; else delete st.overrides[col];
      setStatus('欄位型態已變更，請重新繪製。', '');
    });
    JR.views.applyChartDefaults($('chartType').value, summary.suggested);
  }

  /** 把 SVG 畫到 canvas（兩倍解析度）後輸出 PNG 的 base64（不含 data: 前綴）。 */
  function svgToPngBase64(svg) {
    return new Promise(function (resolve, reject) {
      var m = /width="(\d+)" height="(\d+)"/.exec(svg);
      if (!m) { reject(new Error('圖表尺寸無法判讀')); return; }
      var w = Number(m[1]);
      var h = Number(m[2]);
      var scale = 2;
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = w * scale;
          canvas.height = h * scale;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png').split(',')[1]);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () { reject(new Error('無法把圖表轉為 PNG')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  function exportName() {
    return (st.result && st.result.title) || '量化圖表';
  }

  JR.controllers.chart = {
    /** 依設定顯示或隱藏模組（導覽列按鈕與頁面內容）。 */
    setInstalled: function (on) {
      JR.views.setChartInstalled(on);
      if (!on && document.querySelector('#page-chart.active')) JR.nav.showPage('home');
    },

    bind: function () {
      JR.views.setChartFields($('chartType').value);

      $('chartPick').addEventListener('click', function () {
        api.chart.pickFile().then(function (r) {
          if (!r || r.canceled) return null;
          st.filePath = r.filePath;
          $('chartFile').textContent = r.fileName;
          setStatus('讀取中…');
          return api.chart.inspect({ filePath: r.filePath }).then(function (info) {
            st.sheets = info.sheets;
            if (!info.sheets.length) { setStatus('這個檔案沒有工作表。', 'error'); return; }
            JR.views.fillChartSheets(info.sheets);
            selectSheet();
            $('chartRun').disabled = false;
            setStatus('已讀取 ' + info.sheets.length + ' 個工作表。確認欄位後按「繪製」。', 'ok');
          });
        }).catch(function (err) {
          setStatus('讀取失敗：' + JR.errText(err), 'error');
        });
      });

      $('chartSheet').addEventListener('change', selectSheet);

      $('chartType').addEventListener('change', function () {
        JR.views.setChartFields($('chartType').value);
        var summary = currentSummary();
        if (summary) JR.views.applyChartDefaults($('chartType').value, summary.suggested);
      });

      $('chartRun').addEventListener('click', function () {
        if (!st.filePath) return;
        var cfg = collectConfig();
        $('chartRun').disabled = true;
        setStatus('繪製中…');
        api.chart.render({ filePath: st.filePath, sheet: $('chartSheet').value, config: cfg }).then(function (res) {
          st.result = res;
          JR.views.showChartResult(res);
          setResultReady(true);
          setStatus('已繪製：' + res.title + '（' + res.rowCount + ' 列）', 'ok');
        }).catch(function (err) {
          st.result = null;
          setResultReady(false);
          JR.views.clearChartResult();
          setStatus('無法繪製：' + JR.errText(err), 'error');
        }).then(function () {
          $('chartRun').disabled = false;
        });
      });

      $('chartPng').addEventListener('click', function () {
        if (!st.result) return;
        setStatus('產生 PNG…');
        svgToPngBase64(st.result.svg).then(function (b64) {
          return api.chart.exportPng({ name: exportName(), base64: b64 });
        }).then(function (r) {
          if (r && r.filePath) setStatus('已匯出 PNG：' + r.filePath, 'ok');
        }).catch(function (err) {
          setStatus('匯出失敗：' + JR.errText(err), 'error');
        });
      });

      $('chartSvg').addEventListener('click', function () {
        if (!st.result) return;
        api.chart.exportSvg({ name: exportName(), svg: st.result.svg }).then(function (r) {
          if (r && r.filePath) setStatus('已匯出 SVG：' + r.filePath, 'ok');
        }).catch(function (err) {
          setStatus('匯出失敗：' + JR.errText(err), 'error');
        });
      });

      // 設定頁的模組開關：開啟即「安裝並啟用」，關閉即移除（頁面隱藏）。
      $('setChartModule').addEventListener('change', function () {
        var on = $('setChartModule').checked;
        api.settings.set({ chartModuleEnabled: on }).then(function () {
          JR.controllers.chart.setInstalled(on);
          JR.components.notice(on ? '已安裝並啟用量化圖表模組。' : '已移除量化圖表模組（頁面已隱藏，其他功能不受影響）。');
        }).catch(function (err) {
          $('setChartModule').checked = !on;
          JR.components.notice('設定沒有保存：' + JR.errText(err));
        });
      });

      api.settings.get().then(function (s) {
        JR.views.setChartInstalled(s.chartModuleEnabled === true);
      }).catch(function () {
        JR.views.setChartInstalled(false);
      });
    }
  };
})(window.JR);
