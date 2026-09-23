/*
 * Local preview harness — a tiny in-browser stand-in for Google Apps Script.
 * Loads ../apps-script/Code.gs unchanged, fakes SpreadsheetApp & friends with
 * sheets stored in localStorage, and exposes google.script.run to the HTML
 * pages (which run inside an iframe). NOT deployed to Apps Script.
 */
(function (global) {
  'use strict';
  var STORE_KEY = 'kc_mock_store_v1';
  var store = null;

  function replacer(k, v) { var raw = this[k]; return raw instanceof Date ? { __d: raw.getTime() } : v; }
  function reviver(k, v) { return v && typeof v === 'object' && v.__d !== undefined && Object.keys(v).length === 1 ? new Date(v.__d) : v; }
  function loadStore() {
    try { store = JSON.parse(localStorage.getItem(STORE_KEY) || 'null', reviver); } catch (e) { store = null; }
    if (!store) store = { sheets: {}, order: [], props: {}, cache: {} };
    return store;
  }
  function saveStore() { localStorage.setItem(STORE_KEY, JSON.stringify(store, replacer)); }
  function resetStore() { localStorage.removeItem(STORE_KEY); loadStore(); }

  // ------------------------------------------------------------------ Range
  var CHAIN = ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setHorizontalAlignment', 'setWrap', 'setBorder'];
  function colName(c) { var s = ''; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

  function Range(sheet, row, col, nr, nc) { this.sheet = sheet; this.row = row; this.col = col; this.nr = nr || 1; this.nc = nc || 1; }
  Range.prototype.data = function () { return store.sheets[this.sheet.name]; };
  Range.prototype.getValues = function () {
    var d = this.data(), out = [];
    for (var r = 0; r < this.nr; r++) {
      var src = d[this.row - 1 + r] || [], row = [];
      for (var c = 0; c < this.nc; c++) { var v = src[this.col - 1 + c]; row.push(v === undefined || v === null ? '' : v); }
      out.push(row);
    }
    return out;
  };
  Range.prototype.getValue = function () { return this.getValues()[0][0]; };
  Range.prototype.setValues = function (vals) {
    if (vals.length !== this.nr || vals.some(function (r) { return r.length !== this.nc; }, this)) {
      throw new Error('The number of rows or columns in the data does not match the range.');
    }
    var d = this.data();
    for (var r = 0; r < this.nr; r++) {
      var i = this.row - 1 + r;
      while (d.length <= i) d.push([]);
      for (var c = 0; c < this.nc; c++) d[i][this.col - 1 + c] = vals[r][c];
    }
    return this;
  };
  Range.prototype.setValue = function (v) { return this.setValues([[v]]); };
  Range.prototype.getRow = function () { return this.row; };
  Range.prototype.getNumRows = function () { return this.nr; };
  Range.prototype.getNumColumns = function () { return this.nc; };
  Range.prototype.getSheet = function () { return this.sheet; };
  Range.prototype.getA1Notation = function () {
    var a = colName(this.col) + this.row;
    return this.nr === 1 && this.nc === 1 ? a : a + ':' + colName(this.col + this.nc - 1) + (this.row + this.nr - 1);
  };
  CHAIN.forEach(function (m) { Range.prototype[m] = function () { return this; }; });

  // ------------------------------------------------------------------ Sheet
  function Sheet(name) { this.name = name; }
  Sheet.prototype.data = function () { return store.sheets[this.name]; };
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getLastRow = function () {
    var d = this.data();
    for (var i = d.length - 1; i >= 0; i--) {
      if ((d[i] || []).some(function (v) { return v !== '' && v !== null && v !== undefined; })) return i + 1;
    }
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    return this.data().reduce(function (m, r) {
      for (var j = (r || []).length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== null && r[j] !== undefined) return Math.max(m, j + 1);
      return m;
    }, 0);
  };
  Sheet.prototype.getRange = function (row, col, nr, nc) {
    if (typeof row === 'string') throw new Error('A1 ranges are not supported by the preview mock');
    if (row < 1 || col < 1) throw new Error('Range out of bounds');
    return new Range(this, row, col, nr, nc);
  };
  Sheet.prototype.getDataRange = function () {
    return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  };
  Sheet.prototype.appendRow = function (arr) {
    var d = this.data();
    d.length = this.getLastRow();
    d.push(arr.slice());
    return this;
  };
  ['setFrozenRows', 'setTabColor', 'autoResizeColumns', 'setColumnWidth', 'hideSheet'].forEach(function (m) {
    Sheet.prototype[m] = function () { return this; };
  });

  var SS = {
    getSheetByName: function (n) { return store.sheets[n] ? new Sheet(n) : null; },
    insertSheet: function (n) {
      if (store.sheets[n]) throw new Error('A sheet with the name "' + n + '" already exists.');
      store.sheets[n] = []; store.order.push(n); return new Sheet(n);
    },
    getSheets: function () { return store.order.map(function (n) { return new Sheet(n); }); },
    getName: function () { return 'Kuttyolum Collectorum (preview)'; }
  };

  // ------------------------------------------------------------------ services
  global.SpreadsheetApp = { getActiveSpreadsheet: function () { return SS; }, openById: function () { return SS; } };
  global.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return store.props[k] == null ? null : store.props[k]; },
        setProperty: function (k, v) { store.props[k] = String(v); return this; },
        deleteProperty: function (k) { delete store.props[k]; return this; }
      };
    }
  };
  global.CacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { var e = store.cache[k]; return e && e.exp > Date.now() ? e.v : null; },
        put: function (k, v, s) { store.cache[k] = { v: v, exp: Date.now() + (s || 600) * 1000 }; },
        remove: function (k) { delete store.cache[k]; }
      };
    }
  };
  global.LockService = { getScriptLock: function () { return { waitLock: function () {}, tryLock: function () { return true; }, releaseLock: function () {} }; } };
  global.Session = { getActiveUser: function () { return { getEmail: function () { return ''; } }; } };
  global.ScriptApp = { getService: function () { return { getUrl: function () { return new URL('dashboard.html', location.href).href; } }; } };
  global.ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput: function (s) {
      return { content: String(s), setMimeType: function () { return this; }, getContent: function () { return this.content; } };
    }
  };
  global.Logger = { log: function () { console.log.apply(console, ['[Logger]'].concat([].slice.call(arguments))); } };

  // ------------------------------------------------------------------ google.script.run
  global.__mock = { offline: false, latency: [120, 380] };

  function assertNoDates(v, path) {
    if (v instanceof Date) throw new Error('google.script.run cannot return Date objects (' + path + ')');
    if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { assertNoDates(v[k], path + '.' + k); });
  }

  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return runner(fn, fail); };
        if (prop === 'withFailureHandler') return function (fn) { return runner(ok, fn); };
        if (prop === 'withUserObject') return function () { return runner(ok, fail); };
        return function () {
          var args = JSON.parse(JSON.stringify([].slice.call(arguments)));
          var lat = __mock.latency[0] + Math.random() * (__mock.latency[1] - __mock.latency[0]);
          setTimeout(function () {
            if (__mock.offline) { if (fail) fail(new Error('NetworkError: simulated offline')); return; }
            var fn = global[prop];
            if (typeof fn !== 'function' || /_$/.test(prop)) { if (fail) fail(new Error('Script function not found: ' + String(prop))); return; }
            var res;
            try {
              loadStore();
              res = fn.apply(null, args);
              saveStore();
              assertNoDates(res, String(prop));
              res = res === undefined ? null : JSON.parse(JSON.stringify(res));
            } catch (e) {
              saveStore();
              console.warn('[mock] ' + String(prop) + ' threw:', e);
              if (fail) fail(new Error(e.message));
              return;
            }
            if (ok) ok(res);
          }, lat);
        };
      }
    });
  }
  global.google = { script: { run: runner(null, null) } };

  // ------------------------------------------------------------------ boot
  global.MockGAS = { loadStore: loadStore, saveStore: saveStore, resetStore: resetStore, store: function () { return store; } };

  global.bootPreview = function (page, frameId) {
    return fetch('../apps-script/Code.gs', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (code) {
      (0, eval)(code);  // indirect eval → top-level functions become globals, exactly like Apps Script
      loadStore();
      if (!store.sheets.Registrations) global.seedDemo();
      return fetch('../web/' + page + '.html', { cache: 'no-store' });
    }).then(function (r) { return r.text(); }).then(function (html) {
      var inject = '<script>window.google = parent.google;<\/script>';
      html = html.replace(/<head>/i, '<head>' + inject).replace(/"logo\.png"/g, '"../web/logo.png"');
      document.getElementById(frameId || 'frame').srcdoc = html;
    });
  };
})(window);
