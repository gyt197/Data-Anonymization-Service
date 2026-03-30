// /**
//  * Step 2: PII Scan Module
//  * Depends on window.Step1 for parsed data access.
//  */
// (function (S1) {
//   'use strict';

//   // Configuration for matching HTML IDs
//   var CONFIG = {
//     tableSelectId: 'table-select',
//     btnScanId: 'btn-scan',
//     resultsBodyId: 'scan-results-body',
//     stats: {
//       total: 'stat-pii-total',
//       cols: 'stat-cols-affected',
//       high: 'stat-high-confidence'
//     }
//   };

//   /**
//    * Initializes Step 2 logic and event listeners.
//    */
//   function initStep2() {
//     var scanBtn = document.getElementById(CONFIG.btnScanId);
//     var tableSelect = document.getElementById(CONFIG.tableSelectId);

//     if (!scanBtn || !tableSelect) return;

//     // --- Connection to Step 1 ---
//     // Observe changes in the file list to keep the dropdown menu synchronized
//     var fileList = document.getElementById('file-list');
//     if (fileList) {
//       var observer = new MutationObserver(syncTableOptions);
//       observer.observe(fileList, { childList: true });
//     }

//     // Initial sync in case files are already loaded
//     syncTableOptions();

//     // Bind scan event
//     scanBtn.addEventListener('click', handleScanClick);
//   }

//   /**
//    * Syncs the select dropdown options with Step 1's fileStore.
//    */
//   function syncTableOptions() {
//     var tableSelect = document.getElementById(CONFIG.tableSelectId);
//     var files = S1.fileStore(); // Accessing Step 1's state
    
//     // Save current selection to restore it if possible
//     var currentVal = tableSelect.value;
    
//     tableSelect.innerHTML = files.length === 0 
//       ? '<option value="">No tables uploaded</option>' 
//       : '';

//     files.forEach(function (entry) {
//       var opt = document.createElement('option');
//       opt.value = entry.name;
//       opt.textContent = S1.tableNameFromFilename(entry.name);
//       if (entry.name === currentVal) opt.selected = true;
//       tableSelect.appendChild(opt);
//     });
//   }

//   /**
//    * Logic executed when the "Start Scan" button is clicked.
//    */
//   function handleScanClick() {
//     var tableSelect = document.getElementById(CONFIG.tableSelectId);
//     var fileName = tableSelect.value;

//     if (!fileName) {
//       alert("Please upload and select a table in Step 1 first.");
//       return;
//     }

//     // Retrieve parsed data directly from Step 1's memory
//     var tableName = S1.tableNameFromFilename(fileName);
//     var fullData = S1.originalDataStore()[tableName];

//     if (!fullData) {
//       alert("Data not found in memory. Ensure the file was previewed correctly.");
//       return;
//     }

//     executeApiScan(fullData);
//   }

//   /**
//    * Sends the parsed JSON payload to the Python Backend.
//    * @param { { headers: string[], rows: string[][] } } payload 
//    */
//   function executeApiScan(payload) {
//     var btn = document.getElementById(CONFIG.btnScanId);
//     btn.disabled = true;
//     btn.innerHTML = '<span class="loading-spinner"></span> Scanning...';

//     // The payload sent here matches the structure expected by the Python Presidio logic
//     fetch('http://127.0.0.1:5000/api/scan', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(payload) 
//     })
//     .then(function(res) { 
//       if (!res.ok) throw new Error("Server error: " + res.status);
//       return res.json(); 
//     })
//     .then(function(data) {
//       updateScanUI(data);
//     })
//     .catch(function(err) {
//       console.error("PII Scan Error:", err);
//       alert("Backend connection failed. Please ensure the Python server is running.");
//     })
//     .finally(function() {
//       btn.disabled = false;
//       btn.textContent = 'Start Scan';
//     });
//   }

//   /**
//    * Renders the summary and findings returned by the backend.
//    */
//   function updateScanUI(data) {
//     // 1. Update summary statistics
//     document.getElementById(CONFIG.stats.total).textContent = data.summary.total;
//     document.getElementById(CONFIG.stats.cols).textContent = data.summary.columns;
//     document.getElementById(CONFIG.stats.high).textContent = data.summary.highConfidence;

//     // 2. Populate the results table
//     var tbody = document.getElementById(CONFIG.resultsBodyId);
//     tbody.innerHTML = '';

//     if (data.details.length === 0) {
//       tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No PII detected.</td></tr>';
//       return;
//     }

//     data.details.forEach(function (item) {
//       var tr = document.createElement('tr');
//       // Adding +1 to row index for human-readable display
//       tr.innerHTML = 
//         '<td>' + (item.row + 1) + '</td>' +
//         '<td>' + item.column + '</td>' +
//         '<td><span class="badge badge-pii">' + item.pii_type + '</span></td>' +
//         '<td>' + item.confidence.toFixed(2) + '</td>' +
//         '<td>' + item.value + '</td>';
//       tbody.appendChild(tr);
//     });
//   }

//   // Expose the module
//   window.Step2 = { init: initStep2 };

// })(window.Step1);

// // Initialize Step 2 when DOM is ready
// document.addEventListener('DOMContentLoaded', function() {
//   if (window.Step2) window.Step2.init();
// });

/**
 * Step 2: PII Scanning
 * Improvement: Listens for 'step1:data-change' events.
 * Improvement: Handles "Lazy Parsing" (parses file on scan if not already parsed).
 */
(function (S1) {
  'use strict';

  var CONFIG = {
    tableSelectId: 'table-select',
    btnScanId: 'btn-scan',
    resultsBodyId: 'scan-results-body',
    stats: { total: 'stat-pii-total', cols: 'stat-cols-affected', high: 'stat-high-confidence' },
    /** Default PII scan API base - overridden by window.API_BASE_URL when set */
    apiBase: (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : 'http://localhost:8000'
  };

  var SUPPORTED_EXT = /\.(csv|xls|xlsx)$/i;

  /**
   * Initialize Step 2
   */
  function initStep2() {
    var scanBtn = document.getElementById(CONFIG.btnScanId);
    var tableSelect = document.getElementById(CONFIG.tableSelectId);

    if (!scanBtn || !tableSelect) {
      console.warn('Step 2 UI elements (button or select) not found.');
      return;
    }

    /** Listen for step1:data-change from Step 1 */
    document.addEventListener('step1:data-change', function (e) {
      syncTableOptions(e.detail && e.detail.files ? e.detail.files : []);
    });

    scanBtn.addEventListener('click', handleScanClick);

    /** Initial sync if Step 1 already has files */
    var files = S1 && typeof S1.fileStore === 'function' ? S1.fileStore() : [];
    syncTableOptions(files);
  }

  /**
   * Syncs the dropdown with files from Step 1. Only includes .csv, .xls, .xlsx.
   * @param {Array} files - Array of { name, file } from Step 1
   */
  function syncTableOptions(files) {
    var tableSelect = document.getElementById(CONFIG.tableSelectId);
    var scanBtn = document.getElementById(CONFIG.btnScanId);
    if (!tableSelect || !scanBtn) return;

    var currentVal = tableSelect.value;
    tableSelect.innerHTML = '';

    var supported = (files || []).filter(function (f) {
      return f && f.name && SUPPORTED_EXT.test(f.name);
    });

    if (supported.length === 0) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Please upload a file in Step 1';
      tableSelect.appendChild(opt);
      tableSelect.disabled = true;
      scanBtn.disabled = true;
      return;
    }

    tableSelect.disabled = false;
    scanBtn.disabled = false;

    supported.forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f.name;
      opt.textContent = S1.tableNameFromFilename(f.name);
      if (f.name === currentVal) opt.selected = true;
      tableSelect.appendChild(opt);
    });
  }

  /**
   * Handles the click event for the scan button.
   * Parses CSV/Excel on demand if not already in originalDataStore.
   */
  function handleScanClick() {
    var tableSelect = document.getElementById(CONFIG.tableSelectId);
    var fileName = tableSelect.value;
    if (!fileName) {
      alert("Please select a table.");
      return;
    }

    var tableName = S1.tableNameFromFilename(fileName);
    var parsedData = S1.originalDataStore()[tableName];

    if (parsedData) {
      executeApiScan(parsedData, fileName);
      return;
    }

    var fileEntry = S1.fileStore().find(function (f) { return f.name === fileName; });
    if (!fileEntry) {
      alert("Error: File not found in memory.");
      return;
    }

    var btn = document.getElementById(CONFIG.btnScanId);
    btn.disabled = true;
    btn.textContent = 'Parsing file...';

    var isCsv = /\.csv$/i.test(fileName);

    function done(data) {
      S1.originalDataStore()[tableName] = data;
      executeApiScan(data, fileName);
    }

    function fail(msg) {
      alert(msg || "Failed to read file.");
      btn.disabled = false;
      btn.textContent = 'Start Scan';
    }

    if (isCsv) {
      var fr = new FileReader();
      fr.onload = function () {
        var data = S1.parseCSV(fr.result);
        done(data);
      };
      fr.onerror = function () { fail(); };
      fr.readAsText(fileEntry.file, 'utf-8');
    } else {
      if (!S1.parseExcel || typeof window.XLSX === 'undefined') {
        fail("Excel parsing requires SheetJS. Please preview the file first or add the xlsx library.");
        return;
      }
      var frExcel = new FileReader();
      frExcel.onload = function () {
        var data = S1.parseExcel(frExcel.result);
        if (!data) {
          fail("Failed to parse Excel file.");
          return;
        }
        done(data);
      };
      frExcel.onerror = function () { fail(); };
      frExcel.readAsArrayBuffer(fileEntry.file);
    }
  }

  /**
   * Normalizes payload so rows contain only strings (API expects List[List[str]]).
   * Ensures headers non-empty, filters all-empty rows.
   * @param {{ headers?: string[], rows?: any[][] }} payload
   * @returns {{ headers: string[], rows: string[][] }}
   */
  function normalizePayload(payload) {
    var rawHeaders = payload.headers || [];
    var rawRows = payload.rows || [];
    var headers = rawHeaders.map(function (h) { return h == null ? '' : String(h); });
    if (!headers.length && rawRows.length) {
      headers = rawRows[0].map(function (_, i) { return 'col_' + i; });
    }
    var rows = rawRows
      .filter(function (row) {
        if (!Array.isArray(row)) return false;
        var nonEmpty = row.some(function (c) { return c != null && String(c).trim() !== ''; });
        return nonEmpty;
      })
      .map(function (row) {
        return (Array.isArray(row) ? row : []).map(function (c) {
          return c == null || (typeof c === 'number' && isNaN(c)) ? '' : String(c);
        });
      });
    return { headers: headers, rows: rows };
  }

  /**
   * Sends the data to the Python backend.
   * @param {{ headers: string[], rows: any[][] }} payload - Parsed table data
   * @param {string} [fileName] - File name for Step 3 config population
   */
  function executeApiScan(payload, fileName) {
    var btn = document.getElementById(CONFIG.btnScanId);
    btn.disabled = true;
    btn.innerHTML = 'Scanning...';

    var body = normalizePayload(payload);
    var apiUrl = (window.API_BASE_URL ? String(window.API_BASE_URL).replace(/\/$/, '') : CONFIG.apiBase) + '/api/scan';

    fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function(res) {
      return res.json().catch(function() { return {}; }).then(function(data) {
        if (!res.ok) {
          var detail = (data && data.detail) ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : ('HTTP ' + res.status);
          throw new Error(detail);
        }
        return data;
      });
    })
    .then(function(data) {
      renderResults(data);
      if (fileName && typeof window.populateStep3Config === 'function') {
        window.populateStep3Config(fileName, data.details || []);
      }
    })
    .catch(function(err) {
      console.error("Scan failed:", err);
      var msg = err.message || String(err);
      if (/404/.test(msg)) {
        alert("API not found (404). Ensure uvicorn is running: uvicorn src.api:app --reload");
      } else if (/500|501/.test(String(err)) || msg.indexOf('presidio') !== -1 || msg.indexOf('spacy') !== -1) {
        alert("Server error: " + msg + "\n\nTip: Run: pip install presidio-analyzer spacy && python -m spacy download en_core_web_sm");
      } else if (/failed|network|fetch|TypeError/i.test(msg)) {
        alert("Network error. Ensure API server is running at " + (window.API_BASE_URL || window.location?.origin || "http://localhost:8000"));
      } else {
        alert("Scan failed: " + msg);
      }
    })
    .finally(function() {
      btn.disabled = false;
      btn.textContent = 'Start Scan';
    });
  }

  /**
   * Render scan results into the table and update summary stats.
   * @param {{ summary?: { total?: number, columns?: number, highConfidence?: number }, details?: Array }} data
   */
  function renderResults(data) {
    var tbody = document.getElementById(CONFIG.resultsBodyId);
    if (!tbody) return;

    var summary = data.summary || {};
    var statTotal = document.getElementById(CONFIG.stats.total);
    var statCols = document.getElementById(CONFIG.stats.cols);
    var statHigh = document.getElementById(CONFIG.stats.high);
    if (statTotal) statTotal.textContent = String(summary.total || 0);
    if (statCols) statCols.textContent = String(summary.columns || 0);
    if (statHigh) statHigh.textContent = String(summary.highConfidence || 0);

    tbody.innerHTML = '';

    if (!data.details || data.details.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">No PII found.</td></tr>';
      return;
    }

    data.details.forEach(function(item) {
      var tr = document.createElement('tr');
      tr.innerHTML = 
        '<td>' + (item.row + 1) + '</td>' +
        '<td>' + item.column + '</td>' +
        '<td>' + item.pii_type + '</td>' +
        '<td>' + (item.confidence ? item.confidence.toFixed(2) : 'N/A') + '</td>' +
        '<td>' + item.value + '</td>';
      tbody.appendChild(tr);
    });
  }

  // Expose init function
  window.Step2 = { init: initStep2 };

})(window.Step1);

/** Step 2 init is called from index.html after Step 1 init. */