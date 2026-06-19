/**
 * Populates Step 3 config table from PII scan results.
 * Called by Step 2 after scan completes. Skips columns with empty names.
 * Force PII and Exempt are mutually exclusive (enforced via radio buttons).
 * @param {string} fileName - File name (e.g. "data.csv")
 * @param {Array<{column: string, pii_type?: string}>} scanDetails - PII scan details from API
 */
function populateStep3Config(fileName, scanDetails) {
    var S1 = window.Step1;
    if (!S1 || !S1.originalDataStore || !S1.tableNameFromFilename) return;
  
    var tableName = S1.tableNameFromFilename(fileName);
    var data = S1.originalDataStore()[tableName];
    if (!data || !data.headers) return;
  
    var configSelect = document.getElementById('config-table-select');
    if (!configSelect) return;
  
    var hasOption = false;
    for (var i = 0; i < configSelect.options.length; i++) {
      if (configSelect.options[i].value === fileName) {
        hasOption = true;
        break;
      }
    }
    if (!hasOption) {
      var opt = document.createElement('option');
      opt.value = fileName;
      opt.textContent = tableName;
      configSelect.appendChild(opt);
    }
    configSelect.value = fileName;
  
    var tbody = document.querySelector('#panel-3 .config-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
  
    /** Only include columns with non-empty names (matches original table) */
    var headers = (data.headers || []).filter(function (h) {
      return h != null && String(h).trim() !== '';
    });
  
    var piiSet = {};
    (scanDetails || []).forEach(function (d) { piiSet[d.column] = true; });
  
    headers.forEach(function (col) {
      var isPii = !!piiSet[col];
  
      var tr = document.createElement('tr');
  
      // Escape column name for use in HTML attributes and text
      var colEsc = String(col).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
      // Use column name as the radio group name (must be unique per row).
      // Prefix with "col_" to ensure a valid name attribute.
      var radioName = 'col_' + String(col).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
  
      tr.innerHTML =
        '<td>' + colEsc + '</td>' +
        '<td><span class="badge ' + (isPii ? 'badge-pii' : 'badge-numerical') + '">' +
          (isPii ? 'PII detected' : 'Standard') + '</span></td>' +
  
        // Force PII radio
        '<td><label class="radio-wrap">' +
          '<input type="radio" class="force-pii-radio" name="' + radioName + '" value="force" ' +
          (isPii ? 'checked' : '') + ' data-col="' + colEsc + '" />' +
          '<span>Yes</span>' +
        '</label></td>' +
  
        // Exempt radio
        '<td><label class="radio-wrap">' +
          '<input type="radio" class="exempt-radio" name="' + radioName + '" value="exempt" ' +
          (!isPii ? 'checked' : '') + ' data-col="' + colEsc + '" />' +
          '<span>Yes</span>' +
        '</label></td>';
  
      tbody.appendChild(tr);
    });
  }
  
  /**
   * Validates Step 3 config: each column must have a radio selection
   * (either Force PII or Exempt). Since radios are mutually exclusive by design,
   * only checks that one option is selected per row.
   * @returns {{ valid: boolean, message?: string }}
   */
  function validateStep3Config() {
    var tbody = document.querySelector('#panel-3 .config-table tbody');
    if (!tbody) return { valid: false, message: 'Config table not found.' };
  
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      if (tr.querySelector('td[colspan]')) continue;
  
      var col = tr.querySelector('td:first-child');
      var colName = col ? col.textContent.trim() : '';
      if (!colName) continue;
  
      var forceRadio = tr.querySelector('.force-pii-radio');
      var exemptRadio = tr.querySelector('.exempt-radio');
  
      var force = forceRadio && forceRadio.checked;
      var exempt = exemptRadio && exemptRadio.checked;
  
      if (!force && !exempt) {
        return { valid: false, message: 'Column "' + colName + '": Please choose either Force PII or Exempt.' };
      }
    }
  
    return { valid: true };
  }
  
  window.validateStep3Config = validateStep3Config;
