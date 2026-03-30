/**
 * Step 1: Upload Data + Data Preview.
 * Exposed as window.Step1. Call initStep1(options) after DOM ready.
 * No metadata generation here; that is handled in Step 4.
 */
(function () {
  'use strict';

  var PREVIEW_MAX_ROWS = 10;
  var fileStore = [];
  var originalDataStore = {};
  var previewCurrentKey = null;
  var step1Opts = null;

  /** Supported extensions for preview */
  var SUPPORTED_EXT = /\.(csv|xls|xlsx)$/i;

  /**
   * Parse CSV text; handles quoted fields.
   * @param {string} text - Raw CSV string
   * @returns {{ headers: string[], rows: string[][] }}
   */
  function parseCSV(text) {
    var rows = [];
    var i = 0;
    var len = text.length;
    while (i < len) {
      var row = [];
      var cell = '';
      while (i < len) {
        var c = text[i];
        if (c === '"') {
          i += 1;
          while (i < len && text[i] !== '"') {
            if (text[i] === '\\') i += 1;
            if (i < len) cell += text[i++];
          }
          if (i < len && text[i] === '"') i += 1;
          continue;
        }
        if (c === '\r' || c === '\n' || c === ',') {
          row.push(cell);
          cell = '';
          if (c === ',') { i += 1; continue; }
          i += 1;
          if (c === '\r' && i < len && text[i] === '\n') i += 1;
          break;
        }
        cell += c;
        i += 1;
      }
      if (cell !== '' || row.length > 0) row.push(cell);
      if (row.length && !(row.length === 1 && row[0] === '')) rows.push(row);
    }
    if (!rows.length) return { headers: [], rows: [] };
    var headers = rows[0].slice();
    while (headers.length && String(headers[headers.length - 1]).trim() === '') {
      headers.pop();
    }
    var n = headers.length;
    var dataRows = rows.slice(1).map(function (row) {
      var r = row.slice(0, n);
      while (r.length < n) r.push('');
      return r;
    });
    return { headers: headers, rows: dataRows };
  }

  /**
   * Parse Excel file (arrayBuffer) using SheetJS if available.
   * @param {ArrayBuffer} arrayBuffer - Raw Excel file bytes
   * @returns {{ headers: string[], rows: string[][] } | null}
   */
  function parseExcel(arrayBuffer) {
    if (typeof window === 'undefined' || !window.XLSX) return null;
    try {
      var wb = window.XLSX.read(arrayBuffer, { type: 'array' });
      var firstSheet = wb.SheetNames[0];
      if (!firstSheet) return { headers: [], rows: [] };
      var ws = wb.Sheets[firstSheet];
      var aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!aoa || !aoa.length) return { headers: [], rows: [] };
      var headers = aoa[0].map(function (c) { return String(c); });
      while (headers.length && String(headers[headers.length - 1]).trim() === '') {
        headers.pop();
      }
      var n = headers.length;
      var rows = aoa.slice(1).map(function (r) {
        var arr = (r || []).map(function (c) { return c === null || c === undefined ? '' : String(c); });
        arr = arr.slice(0, n);
        while (arr.length < n) arr.push('');
        return arr;
      });
      return { headers: headers, rows: rows };
    } catch (e) {
      return null;
    }
  }

  /**
   * Derive table name from filename (removes extension).
   * @param {string} name - File name
   * @returns {string}
   */
  function tableNameFromFilename(name) {
    return name.replace(/\.(csv|xls|xlsx)$/i, '');
  }

  /**
   * Render preview table into container.
   * @param {HTMLElement} container - Container element
   * @param {{ headers: string[], rows: string[][] }} data - Parsed table data
   * @param {number} [maxRows] - Max rows to show
   * @returns {{ wrap: HTMLElement, table: HTMLTableElement }}
   */
  function renderPreviewTable(container, data, maxRows) {
    maxRows = maxRows == null ? PREVIEW_MAX_ROWS : maxRows;
    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'data-table-wrap preview-table-wrap';
    var table = document.createElement('table');
    table.className = 'data-table';
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    (data.headers || []).forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    var slice = (data.rows || []).slice(0, maxRows);
    slice.forEach(function (r) {
      var tr = document.createElement('tr');
      r.forEach(function (c) {
        var td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    return { wrap: wrap, table: table };
  }

  /**
   * Emit step1:data-change so Step 2 / Step 3 / Step 4 can sync.
   */
  function emitStep1DataChange() {
    try {
      document.dispatchEvent(new CustomEvent('step1:data-change', { detail: { files: fileStore.slice() } }));
    } catch (e) { /* noop */ }
  }

  /**
   * Build file list UI.
   */
  function buildFileListUI() {
    var listId = (step1Opts && step1Opts.fileListId) ? step1Opts.fileListId : 'file-list';
    var list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';
    fileStore.forEach(function (entry) {
      var li = document.createElement('li');
      li.dataset.name = entry.name;
      var size = entry.file.size ? (entry.file.size / 1024).toFixed(1) + ' KB' : '';
      li.innerHTML =
        '<div class="file-name">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> ' +
        entry.name + '</div>' +
        '<span class="file-meta">' + size + '</span>' +
        '<button type="button" class="file-remove" title="Remove" aria-label="Remove">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>';
      li.querySelector('.file-remove').addEventListener('click', function () {
        removeFile(entry.name);
      });
      list.appendChild(li);
    });
  }

  /**
   * Remove file from store and refresh UI.
   * @param {string} name - File name
   */
  function removeFile(name) {
    var idx = fileStore.findIndex(function (e) { return e.name === name; });
    if (idx === -1) return;
    fileStore.splice(idx, 1);
    var tn = tableNameFromFilename(name);
    delete originalDataStore[tn];
    if (previewCurrentKey === name) {
      previewCurrentKey = fileStore.length ? fileStore[0].name : null;
    }
    buildFileListUI();
    refreshPreviewSelect();
    refreshPreviewTable();
    emitStep1DataChange();
  }

  /**
   * Refresh preview file selector dropdown.
   */
  function refreshPreviewSelect() {
    var rowId = (step1Opts && step1Opts.previewSelectRowId) ? step1Opts.previewSelectRowId : 'preview-select-row';
    var selId = (step1Opts && step1Opts.previewFileSelectId) ? step1Opts.previewFileSelectId : 'preview-file-select';
    var row = document.getElementById(rowId);
    var sel = document.getElementById(selId);
    if (!row || !sel) return;
    row.style.display = fileStore.length > 1 ? 'flex' : 'none';
    sel.innerHTML = '';
    fileStore.forEach(function (e) {
      var opt = document.createElement('option');
      opt.value = e.name;
      opt.textContent = e.name;
      if (e.name === previewCurrentKey) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  /**
   * Refresh preview table based on current selection.
   */
  function refreshPreviewTable() {
    var emptyId = (step1Opts && step1Opts.previewEmptyId) ? step1Opts.previewEmptyId : 'preview-empty';
    var contentId = (step1Opts && step1Opts.previewContentId) ? step1Opts.previewContentId : 'preview-content';
    var statsId = (step1Opts && step1Opts.previewStatsId) ? step1Opts.previewStatsId : 'preview-stats';
    var containerId = (step1Opts && step1Opts.previewTableContainerId) ? step1Opts.previewTableContainerId : 'preview-table-container';
    var empty = document.getElementById(emptyId);
    var content = document.getElementById(contentId);
    var stats = document.getElementById(statsId);
    var tableContainer = document.getElementById(containerId);
    if (!empty || !content || !stats || !tableContainer) return;

    if (!fileStore.length || !previewCurrentKey) {
      empty.style.display = 'block';
      content.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    content.style.display = 'block';

    var entry = fileStore.find(function (e) { return e.name === previewCurrentKey; });
    if (!entry || !SUPPORTED_EXT.test(entry.name)) {
      stats.textContent = 'Preview supports .csv, .xls, .xlsx only.';
      tableContainer.innerHTML = '';
      return;
    }

    var tn = tableNameFromFilename(entry.name);
    var data = originalDataStore[tn];
    if (!data) {
      stats.textContent = 'Parsing…';
      tableContainer.innerHTML = '';
      var isCsv = /\.csv$/i.test(entry.name);
      if (isCsv) {
        var fr = new FileReader();
        fr.onload = function () {
          data = parseCSV(fr.result);
          originalDataStore[tn] = data;
          stats.textContent = data.rows.length + ' rows, ' + (data.headers.length) + ' columns';
          renderPreviewTable(tableContainer, data, PREVIEW_MAX_ROWS);
        };
        fr.readAsText(entry.file, 'utf-8');
      } else {
        var frExcel = new FileReader();
        frExcel.onload = function () {
          data = parseExcel(frExcel.result);
          if (!data) {
            stats.textContent = 'Excel preview requires SheetJS. Add xlsx library.';
            return;
          }
          originalDataStore[tn] = data;
          stats.textContent = data.rows.length + ' rows, ' + (data.headers.length) + ' columns';
          renderPreviewTable(tableContainer, data, PREVIEW_MAX_ROWS);
        };
        frExcel.readAsArrayBuffer(entry.file);
      }
      return;
    }
    stats.textContent = data.rows.length + ' rows, ' + (data.headers.length) + ' columns';
    renderPreviewTable(tableContainer, data, PREVIEW_MAX_ROWS);
  }

  /**
   * Initialize Step 1: bind dropzone, file input, preview select.
   * @param {{
   *   dropzoneId?: string,
   *   fileInputId?: string,
   *   fileListId?: string,
   *   previewEmptyId?: string,
   *   previewContentId?: string,
   *   previewSelectRowId?: string,
   *   previewFileSelectId?: string,
   *   previewStatsId?: string,
   *   previewTableContainerId?: string,
   *   onToast?: function(string, string)
   * }} options
   */
  function initStep1(options) {
    step1Opts = options || {};
    var dropzoneId = step1Opts.dropzoneId || 'dropzone';
    var fileInputId = step1Opts.fileInputId || 'file-input';
    var fileListId = step1Opts.fileListId || 'file-list';
    var onToast = typeof step1Opts.onToast === 'function' ? step1Opts.onToast : null;

    var dropzone = document.getElementById(dropzoneId);
    var fileInput = document.getElementById(fileInputId);
    var fileList = document.getElementById(fileListId);

    if (dropzone && fileInput && fileList) {
      dropzone.addEventListener('click', function () { fileInput.click(); });
      ['dragenter', 'dragover'].forEach(function (e) {
        dropzone.addEventListener(e, function (ev) {
          ev.preventDefault();
          dropzone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (e) {
        dropzone.addEventListener(e, function (ev) {
          ev.preventDefault();
          dropzone.classList.remove('dragover');
        });
      });
      fileInput.addEventListener('change', function () {
        var files = fileInput.files;
        if (!files || files.length === 0) return;
        var added = 0;
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          if (fileStore.some(function (e) { return e.name === f.name; })) continue;
          fileStore.push({ name: f.name, file: f });
          added += 1;
        }
        if (added) {
          if (onToast) onToast(added + ' file(s) added.', 'success');
          if (!previewCurrentKey && fileStore.length) previewCurrentKey = fileStore[0].name;
          buildFileListUI();
          refreshPreviewSelect();
          refreshPreviewTable();
          emitStep1DataChange();
        }
        fileInput.value = '';
      });
    }

    var selId = step1Opts.previewFileSelectId || 'preview-file-select';
    var previewSelect = document.getElementById(selId);
    if (previewSelect) {
      previewSelect.addEventListener('change', function () {
        previewCurrentKey = this.value || null;
        refreshPreviewTable();
      });
    }

    buildFileListUI();
    refreshPreviewSelect();
    refreshPreviewTable();
    emitStep1DataChange();
  }

  window.Step1 = {
    initStep1: initStep1,
    parseCSV: parseCSV,
    parseExcel: parseExcel,
    renderPreviewTable: renderPreviewTable,
    tableNameFromFilename: tableNameFromFilename,
    SUPPORTED_EXT: SUPPORTED_EXT,
    PREVIEW_MAX_ROWS: PREVIEW_MAX_ROWS,
    fileStore: function () { return fileStore; },
    originalDataStore: function () { return originalDataStore; },
    previewCurrentKey: function () { return previewCurrentKey; }
  };
})();
