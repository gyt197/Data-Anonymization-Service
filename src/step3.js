/**
 * Populates Step 3 config table from PII scan results.
 * Called by Step 2 after scan completes. Skips columns with empty names.
 * Force PII and Exempt are mutually exclusive.
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
    var colEsc = String(col).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    tr.innerHTML =
      '<td>' + colEsc + '</td>' +
      '<td><span class="badge ' + (isPii ? 'badge-pii' : 'badge-numerical') + '">' +
      (isPii ? 'PII detected' : 'Standard') + '</span></td>' +
      '<td><label class="checkbox-wrap"><input type="checkbox" class="force-pii-chk" ' +
      (isPii ? 'checked' : '') + ' data-col="' + colEsc + '" /><span>Yes</span></label></td>' +
      '<td><label class="checkbox-wrap"><input type="checkbox" class="exempt-chk" data-col="' + colEsc + '" /><span>Yes</span></label></td>';
    tbody.appendChild(tr);

    var forceChk = tr.querySelector('.force-pii-chk');
    var exemptChk = tr.querySelector('.exempt-chk');

    /** Force PII and Exempt mutually exclusive: checking one unchecks the other */
    if (forceChk) {
      forceChk.addEventListener('change', function () {
        if (forceChk.checked && exemptChk) exemptChk.checked = false;
      });
    }
    if (exemptChk) {
      exemptChk.addEventListener('change', function () {
        if (exemptChk.checked && forceChk) forceChk.checked = false;
      });
    }
  });
}

/**
 * Validates Step 3 config: each column must have either Force PII or Exempt (not both, not neither).
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
    var forceChk = tr.querySelector('.force-pii-chk');
    var exemptChk = tr.querySelector('.exempt-chk');
    var force = forceChk && forceChk.checked;
    var exempt = exemptChk && exemptChk.checked;
    if (force && exempt) {
      return { valid: false, message: 'Column "' + colName + '": Force PII and Exempt cannot both be selected.' };
    }
    if (!force && !exempt) {
      return { valid: false, message: 'Column "' + colName + '": Please choose either Force PII or Exempt.' };
    }
  }
  return { valid: true };
}

window.validateStep3Config = validateStep3Config;