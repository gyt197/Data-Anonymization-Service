/**
 * Step 4: Results — Anonymize, Select Table, Preview/Compare/Download.
 * Uses Step 1 fileStore and Step 3 config (exempt_columns, force_pii_columns).
 * All UI text in English.
 */
(function (S1) {
  'use strict';

  var API_BASE = 'http://localhost:8000';
  var PREVIEW_MAX_ROWS = 10;

  /**
   * Fetches synthetic table names and quality scores from API.
   * @param {string} baseUrl - API base URL
   * @returns {Promise<{ tables: string[], scores: Object<string, number> }>}
   */
  function fetchSyntheticTables(baseUrl) {
    var url = (baseUrl || API_BASE).replace(/\/$/, '') + '/api/synthetic-tables';
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to fetch synthetic tables: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        return {
          tables: (data.tables || []).slice(),
          scores: data.scores || {}
        };
      });
  }

  /**
   * Fetches synthetic CSV content for a table.
   * @param {string} tableName - Table name (no extension)
   * @param {string} baseUrl - API base URL
   * @returns {Promise<string>}
   */
  function fetchSyntheticCsv(tableName, baseUrl) {
    var url = (baseUrl || API_BASE).replace(/\/$/, '') + '/api/synthetic/' + encodeURIComponent(tableName);
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to fetch synthetic: ' + res.status);
        return res.text();
      });
  }

  /**
   * Escapes HTML to prevent XSS.
   * @param {string} s
   * @returns {string}
   */
  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /**
   * Renders inline preview in content area.
   * @param {string} tableName
   * @param {string} baseUrl
   * @param {Function} [onToast]
   */
  function renderInlinePreview(tableName, baseUrl, onToast) {
    var area = document.getElementById('step4-content-area');
    if (!area) return;
    area.innerHTML = '<p class="empty-state">Loading…</p>';

    fetchSyntheticCsv(tableName, baseUrl)
      .then(function (csv) {
        var parseCSV = S1 && S1.parseCSV;
        var renderPreviewTable = S1 && S1.renderPreviewTable;
        if (!parseCSV || !renderPreviewTable) {
          area.innerHTML = '<p class="empty-state">Preview helpers not available.</p>';
          return;
        }
        var data = parseCSV(csv);
        var container = document.createElement('div');
        renderPreviewTable(container, data, PREVIEW_MAX_ROWS);
        var stats = '<p class="preview-stats" style="margin-bottom: 0.75rem;">' + data.rows.length + ' rows, ' + data.headers.length + ' columns (showing first ' + Math.min(PREVIEW_MAX_ROWS, data.rows.length) + ')</p>';
        area.innerHTML = stats;
        area.appendChild(container);
      })
      .catch(function (err) {
        area.innerHTML = '<p class="empty-state">Failed to load: ' + escapeHtml(err.message || String(err)) + '</p>';
      });
  }

  /**
   * Renders inline compare (Original vs Synthetic) in content area.
   * @param {string} tableName
   * @param {string} baseUrl
   * @param {Function} [onToast]
   */
  function renderInlineCompare(tableName, baseUrl, onToast) {
    var area = document.getElementById('step4-content-area');
    if (!area) return;
    area.innerHTML = '<p class="empty-state">Loading…</p>';

    var origStore = S1 && typeof S1.originalDataStore === 'function' ? S1.originalDataStore() : {};
    var orig = origStore[tableName];
    var parseCSV = S1 && S1.parseCSV;
    var renderPreviewTable = S1 && S1.renderPreviewTable;

    function buildCompare(origData, synthData) {
      var row = document.createElement('div');
      row.className = 'step4-compare-row';

      var left = document.createElement('div');
      left.className = 'step4-compare-half';
      var leftH = document.createElement('h4');
      leftH.textContent = 'Original';
      left.appendChild(leftH);
      var leftWrap = document.createElement('div');
      left.appendChild(leftWrap);

      var right = document.createElement('div');
      right.className = 'step4-compare-half';
      var rightH = document.createElement('h4');
      rightH.textContent = 'Synthetic';
      right.appendChild(rightH);
      var rightWrap = document.createElement('div');
      right.appendChild(rightWrap);

      if (!origData) {
        leftWrap.innerHTML = '<p class="empty-state">Original data not available. Upload this file in Step 1 to compare.</p>';
      } else if (renderPreviewTable) {
        var r1 = renderPreviewTable(leftWrap, origData, PREVIEW_MAX_ROWS);
        leftWrap.innerHTML = '';
        leftWrap.appendChild(r1.wrap);
      }

      if (!synthData) {
        rightWrap.innerHTML = '<p class="empty-state">No synthetic data available.</p>';
      } else if (renderPreviewTable) {
        var r2 = renderPreviewTable(rightWrap, synthData, PREVIEW_MAX_ROWS);
        rightWrap.innerHTML = '';
        rightWrap.appendChild(r2.wrap);
      }

      var totalRows = origData ? origData.rows.length : (synthData ? synthData.rows.length : 0);
      var showRows = Math.min(PREVIEW_MAX_ROWS, totalRows);
      var footer = document.createElement('p');
      footer.className = 'compare-footer';
      footer.style.cssText = 'margin-top: 0.75rem; font-size: 0.9rem; color: var(--text-muted);';
      footer.textContent = totalRows ? 'Showing first ' + showRows + ' of ' + totalRows + ' rows.' : 'No data to compare.';

      row.appendChild(left);
      row.appendChild(right);
      var wrap = document.createElement('div');
      wrap.appendChild(row);
      wrap.appendChild(footer);
      return wrap;
    }

    fetchSyntheticCsv(tableName, baseUrl)
      .then(function (csv) {
        var synth = parseCSV ? parseCSV(csv) : null;
        var wrap = buildCompare(orig, synth);
        area.innerHTML = '';
        area.appendChild(wrap);
        var leftWrap = area.querySelector('.step4-compare-half:first-child .data-table-wrap');
        var rightWrap = area.querySelector('.step4-compare-half:last-child .data-table-wrap');
        if (leftWrap && rightWrap) {
          leftWrap.addEventListener('scroll', function () { rightWrap.scrollLeft = leftWrap.scrollLeft; });
          rightWrap.addEventListener('scroll', function () { leftWrap.scrollLeft = rightWrap.scrollLeft; });
        }
      })
      .catch(function (err) {
        area.innerHTML = '<p class="empty-state">Failed to load synthetic: ' + escapeHtml(err.message || String(err)) + '</p>';
      });
  }

  /**
   * Renders download section in content area.
   * @param {string} tableName
   * @param {string} baseUrl
   * @param {Function} [onToast]
   */
  function renderInlineDownload(tableName, baseUrl, onToast) {
    var area = document.getElementById('step4-content-area');
    if (!area) return;

    var url = (baseUrl || API_BASE).replace(/\/$/, '') + '/api/synthetic/' + encodeURIComponent(tableName);
    area.innerHTML =
      '<p style="margin-bottom: 1rem;">Download synthetic data as CSV (table format).</p>' +
      '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" class="btn btn-primary">Download CSV</a>';

    if (onToast) onToast('Click the button above to download.', 'success');
  }

  /** Shared scores map for badge updates when table selection changes */
  var step4Scores = {};

  /**
   * Populates table dropdown and updates visibility/quality badge.
   * @param {string[]} tables
   * @param {Object.<string, number>} scores
   * @param {string} baseUrl
   */
  function refreshTableDropdown(tables, scores, baseUrl) {
    scores = scores || {};
    step4Scores = scores;
    var sel = document.getElementById('step4-table-select');
    var section = document.getElementById('step4-table-section');
    var actions = document.getElementById('step4-actions');
    var badge = document.getElementById('step4-quality-badge');

    if (!sel || !section || !actions) return;

    if (tables.length === 0) {
      section.style.display = 'none';
      actions.style.display = 'none';
      sel.innerHTML = '<option value="">—</option>';
      if (badge) badge.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    actions.style.display = 'block';

    var cur = sel.value;
    sel.innerHTML = '';
    var def = document.createElement('option');
    def.value = '';
    def.textContent = '—';
    sel.appendChild(def);
    tables.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === cur) opt.selected = true;
      sel.appendChild(opt);
    });

    if (badge) {
      var v = sel.value || tables[0];
      var sc = scores[v];
      if (sc != null && !isNaN(sc)) {
        badge.textContent = 'Quality: ' + (Math.round(sc * 1000) / 10) + '%';
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  /**
   * Fills the source table dropdown from Step 1 fileStore (same as Step 2/3).
   * Uses window.Step1 at call time so it stays in sync regardless of load order.
   * Filters by .csv / .xls / .xlsx and keeps one empty option when no files.
   */
  function refreshStep4SourceDropdown() {
    var sel = document.getElementById('step4-source-table-select');
    if (!sel) return;
    var files = (window.Step1 && typeof window.Step1.fileStore === 'function') ? window.Step1.fileStore() : [];
    var supported = files.filter(function (f) { return f && f.name && /\.(csv|xls|xlsx)$/i.test(f.name); });
    var cur = sel.value;
    sel.innerHTML = supported.length ? '' : '<option value="">Please upload a file in Step 1</option>';
    if (supported.length) {
      var tableNameFromFilename = (window.Step1 && window.Step1.tableNameFromFilename) ? window.Step1.tableNameFromFilename : function (name) { return (name || '').replace(/\.(csv|xls|xlsx)$/i, ''); };
      supported.forEach(function (f) {
        var opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = tableNameFromFilename(f.name);
        if (f.name === cur) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  }

  /**
   * Shows or clears the persistent error message below the Anonymize button.
   * @param {string} [msg] - Error text; empty or omit to clear
   */
  function setStep4Error(msg) {
    var el = document.getElementById('step4-error-msg');
    if (!el) return;
    el.textContent = msg || '';
  }

  /**
   * Updates Step 3 config hint.
   */
  function updateConfigHint() {
    var hint = document.getElementById('step4-config-hint');
    var configSel = document.getElementById('config-table-select');
    if (!hint || !configSel) return;

    var val = configSel ? configSel.value : '';
    if (val) {
      hint.textContent = 'Using config from Step 3 for: ' + val;
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }

  /**
   * Initialize Step 4.
   * @param {{ onToast?: Function, apiBaseUrl?: string }} [opts]
   */
  function initStep4(opts) {
    opts = opts || {};
    var onToast = typeof opts.onToast === 'function' ? opts.onToast : (typeof window.showToast === 'function' ? window.showToast : null);
    var baseUrl = opts.apiBaseUrl || API_BASE;

    /** Source table dropdown (Step 1 files), synced with step1:data-change */
    refreshStep4SourceDropdown();
    document.addEventListener('step1:data-change', refreshStep4SourceDropdown);

    /** Step 3 config hint */
    updateConfigHint();
    var configSelEl = document.getElementById('config-table-select');
    if (configSelEl) configSelEl.addEventListener('change', updateConfigHint);
    document.addEventListener('step1:data-change', updateConfigHint);

    /** Anonymize button */
    var anonymizeBtn = document.getElementById('btn-anonymize');
    var btnDefaultHTML = anonymizeBtn ? anonymizeBtn.innerHTML : '';

    if (anonymizeBtn) {
      anonymizeBtn.addEventListener('click', function () {
        setStep4Error('');

        try {
          var files = S1 && typeof S1.fileStore === 'function' ? S1.fileStore() : [];
          var supported = files.filter(function (f) { return f && f.name && /\.(csv|xls|xlsx)$/i.test(f.name); });

          if (supported.length === 0) {
            var msg = 'Please upload CSV/Excel files in Step 1 first.';
            setStep4Error(msg);
            if (onToast) onToast(msg, 'error');
            return;
          }

          var configSel = document.getElementById('config-table-select');
          var configForTable = configSel ? (configSel.value || '').trim() : '';
          var exempt = [];
          var forcePii = [];

          if (configForTable) {
            var valid = window.validateStep3Config && window.validateStep3Config();
            if (valid && !valid.valid) {
              var errMsg = valid.message || 'Please complete Force PII or Exempt for each column in Step 3.';
              setStep4Error(errMsg);
              if (onToast) onToast(errMsg, 'error');
              return;
            }
            var tbody = document.querySelector('#panel-3 .config-table tbody');
            if (tbody) {
              tbody.querySelectorAll('tr').forEach(function (tr) {
                if (tr.querySelector('td[colspan]')) return;
                var col = tr.querySelector('td:first-child');
                var colName = col ? col.textContent.trim() : '';
                if (!colName) return;
                var forceChk = tr.querySelector('.force-pii-chk') || tr.querySelector('td:nth-child(3) input[type="checkbox"]');
                var exemptChk = tr.querySelector('.exempt-chk') || tr.querySelector('td:nth-child(4) input[type="checkbox"]');
                if (exemptChk && exemptChk.checked) exempt.push(colName);
                if (forceChk && forceChk.checked) forcePii.push(colName);
              });
            }
          } else if (onToast) {
            onToast('No table selected in Step 3. Using default config.', 'default');
          }

          anonymizeBtn.disabled = true;
          anonymizeBtn.textContent = 'Anonymizing…';

          var formData = new FormData();
          supported.forEach(function (e) { formData.append('files', e.file); });
          formData.append('user_config', JSON.stringify({ exempt_columns: exempt, force_pii_columns: forcePii }));
          if (configForTable) formData.append('config_for_table', configForTable);

        fetch((baseUrl || API_BASE).replace(/\/$/, '') + '/api/anonymize', { method: 'POST', body: formData })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (r) { throw new Error(r.detail || r.message || 'Request failed'); });
            return res.json();
          })
          .then(function (report) {
            setStep4Error('');
            if (report.errors && report.errors.length) {
              var errText = 'Anonymization completed with errors: ' + report.errors.join('; ');
              setStep4Error(errText);
              if (onToast) onToast(errText, 'error');
            } else {
              if (onToast) onToast('Anonymization complete. Processed ' + (report.processed_files || []).length + ' file(s).', 'success');
            }
            var pf = report.processed_files || [];
            var tables = pf.length > 0 ? pf.map(function (p) { return p.table; }) : [];
            var scores = {};
            pf.forEach(function (p) { if (p.score != null) scores[p.table] = p.score; });

            if (tables.length > 0) {
              refreshTableDropdown(tables, scores, baseUrl);
              var sel = document.getElementById('step4-table-select');
              if (sel) sel.value = tables[0];
              var badge = document.getElementById('step4-quality-badge');
              if (badge && scores[tables[0]] != null) {
                badge.textContent = 'Quality: ' + (Math.round(scores[tables[0]] * 1000) / 10) + '%';
                badge.style.display = 'inline';
              }
            } else {
              return fetchSyntheticTables(baseUrl).then(function (data) {
                refreshTableDropdown(data.tables, data.scores, baseUrl);
                return data;
              });
            }
          })
          .then(function (data) {
            if (data && data.tables && data.tables.length) {
              refreshTableDropdown(data.tables, data.scores, baseUrl);
              var sel = document.getElementById('step4-table-select');
              if (sel) sel.value = data.tables[0];
            }
          })
          .catch(function (err) {
            var errText = 'Anonymization failed: ' + (err.message || err);
            setStep4Error(errText);
            if (onToast) onToast(errText, 'error');
            try { console.error('Step4 anonymize:', err); } catch (e) {}
          })
          .finally(function () {
            anonymizeBtn.disabled = false;
            anonymizeBtn.innerHTML = btnDefaultHTML;
          });

        } catch (err) {
          var errText = err && err.message ? err.message : String(err);
          setStep4Error('Error: ' + errText);
          if (onToast) onToast('Error: ' + errText, 'error');
          try { console.error('Step4 anonymize (sync):', err); } catch (e) {}
        }
      });
    }

    /** Table selection, Preview, Compare, Download */
    var tableSel = document.getElementById('step4-table-select');
    var previewBtn = document.getElementById('btn-step4-preview');
    var compareBtn = document.getElementById('btn-step4-compare');
    var downloadBtn = document.getElementById('btn-step4-download');
    var contentArea = document.getElementById('step4-content-area');

    function getSelectedTable() {
      return tableSel ? tableSel.value : '';
    }

    if (tableSel) {
      tableSel.addEventListener('change', function () {
        var badge = document.getElementById('step4-quality-badge');
        if (!badge) return;
        var v = this.value;
        var sc = step4Scores[v];
        if (v && sc != null && !isNaN(sc)) {
          badge.textContent = 'Quality: ' + (Math.round(sc * 1000) / 10) + '%';
          badge.style.display = 'inline';
        } else {
          badge.style.display = 'none';
        }
      });
    }

    if (previewBtn) {
      previewBtn.addEventListener('click', function () {
        var t = getSelectedTable();
        if (!t) {
          if (onToast) onToast('Please select a table first.', 'error');
          return;
        }
        renderInlinePreview(t, baseUrl, onToast);
      });
    }
    if (compareBtn) {
      compareBtn.addEventListener('click', function () {
        var t = getSelectedTable();
        if (!t) {
          if (onToast) onToast('Please select a table first.', 'error');
          return;
        }
        renderInlineCompare(t, baseUrl, onToast);
      });
    }
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function () {
        var t = getSelectedTable();
        if (!t) {
          if (onToast) onToast('Please select a table first.', 'error');
          return;
        }
        renderInlineDownload(t, baseUrl, onToast);
      });
    }

    /** Initial load */
    fetchSyntheticTables(baseUrl)
      .then(function (data) {
        refreshTableDropdown(data.tables, data.scores, baseUrl);
      })
      .catch(function () {
        refreshTableDropdown([], {}, baseUrl);
      });
  }

  /** Expose so main app can refresh source dropdown when entering Step 4 */
  window.Step4 = { init: initStep4, refreshSourceDropdown: refreshStep4SourceDropdown };
})(window.Step1);
