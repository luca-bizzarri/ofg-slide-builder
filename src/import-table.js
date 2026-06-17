/* ============================================================
   import-table.js — Importazione tabelle OFG
   Converte fogli di calcolo (.xlsx / .xls / .csv) e testo
   incollato da Excel (TSV) in tabelle utilizzabili nelle slide,
   e produce il blocco markdown nel formato dell'app (":: table").
   Unica dipendenza esterna: window.XLSX (SheetJS 0.18.x),
   gia' caricata da index.html prima di questo script.
   ============================================================ */
(function () {
  'use strict';

  window.OFG = window.OFG || {};

  // ----------------------------------------------------------
  // Helper interni
  // ----------------------------------------------------------

  /* Converte una cella qualsiasi in stringa "leggibile".
     - null / undefined -> stringa vuota
     - tutto il resto -> String(value)
     (numeri e date arrivano gia' formattati quando usiamo raw:false
     in sheet_to_json, vedi sotto). */
  function cellToString(value) {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  /* Data una matrice (array di array), trova l'indice dell'ultima
     colonna che contiene almeno un valore non vuoto, cosi' da poter
     troncare le colonne completamente vuote in coda. Ritorna -1 se
     tutte le colonne sono vuote. */
  function lastNonEmptyColumn(matrix) {
    var last = -1;
    for (var r = 0; r < matrix.length; r++) {
      var row = matrix[r] || [];
      for (var c = 0; c < row.length; c++) {
        if (cellToString(row[c]) !== '') {
          if (c > last) last = c;
        }
      }
    }
    return last;
  }

  /* Normalizza una riga: la porta a lunghezza fissa "width",
     convertendo ogni cella in stringa e riempiendo con '' i buchi. */
  function normalizeRow(row, width) {
    var out = [];
    row = row || [];
    for (var i = 0; i < width; i++) {
      out.push(cellToString(row[i]));
    }
    return out;
  }

  /* Trova l'indice della prima riga "non vuota" (almeno una cella
     con contenuto). Ritorna -1 se la matrice e' tutta vuota. */
  function firstNonEmptyRow(matrix) {
    for (var r = 0; r < matrix.length; r++) {
      var row = matrix[r] || [];
      for (var c = 0; c < row.length; c++) {
        if (cellToString(row[c]) !== '') return r;
      }
    }
    return -1;
  }

  /* Costruisce { headers, rows } da una matrice grezza (array di array):
     - prima riga NON vuota = headers
     - righe successive = rows
     - tronca le colonne vuote in coda
     Su matrice vuota ritorna { headers: [], rows: [] }. */
  function matrixToTable(matrix) {
    if (!matrix || !matrix.length) return { headers: [], rows: [] };

    var headerIdx = firstNonEmptyRow(matrix);
    if (headerIdx === -1) return { headers: [], rows: [] };

    var lastCol = lastNonEmptyColumn(matrix);
    if (lastCol === -1) return { headers: [], rows: [] };
    var width = lastCol + 1;

    var headers = normalizeRow(matrix[headerIdx], width);

    var rows = [];
    for (var r = headerIdx + 1; r < matrix.length; r++) {
      rows.push(normalizeRow(matrix[r], width));
    }

    return { headers: headers, rows: rows };
  }

  /* Escapa il contenuto di una cella per il markdown tabellare:
     - le pipe "|" diventano "\|"
     - i newline (anche \r\n) diventano spazio (celle su singola riga). */
  function escapeCell(value) {
    var s = cellToString(value);
    s = s.replace(/\r\n|\r|\n/g, ' ');
    s = s.replace(/\|/g, '\\|');
    return s;
  }

  // ----------------------------------------------------------
  // API pubblica: OFG.tables
  // ----------------------------------------------------------

  var tables = {

    /* Legge un file .xlsx/.xls/.csv e ritorna una Promise con
       { headers, rows, name }. Legge sempre il PRIMO foglio. */
    fromFile: function (file) {
      return new Promise(function (resolve, reject) {
        if (typeof window.XLSX === 'undefined' || !window.XLSX) {
          reject(new Error('Libreria XLSX non disponibile: impossibile leggere il file.'));
          return;
        }
        if (!file) {
          reject(new Error('Nessun file fornito.'));
          return;
        }

        var reader = new FileReader();

        reader.onerror = function () {
          reject(new Error('Impossibile leggere il file "' + (file.name || '') + '".'));
        };

        reader.onload = function (e) {
          try {
            var data = new Uint8Array(e.target.result);
            var workbook = window.XLSX.read(data, { type: 'array' });

            var sheetNames = workbook.SheetNames || [];
            if (!sheetNames.length) {
              resolve({ headers: [], rows: [], name: file.name || '' });
              return;
            }

            var sheet = workbook.Sheets[sheetNames[0]];
            /* header:1 -> matrice (array di array).
               raw:false -> usa i valori formattati (numeri/date leggibili).
               defval:'' -> le celle mancanti diventano stringa vuota. */
            var matrix = window.XLSX.utils.sheet_to_json(sheet, {
              header: 1,
              raw: false,
              defval: ''
            });

            var table = matrixToTable(matrix);
            resolve({
              headers: table.headers,
              rows: table.rows,
              name: file.name || ''
            });
          } catch (err) {
            reject(new Error('File non leggibile o formato non supportato: ' + (err && err.message ? err.message : err)));
          }
        };

        try {
          reader.readAsArrayBuffer(file);
        } catch (err) {
          reject(new Error('Impossibile avviare la lettura del file: ' + (err && err.message ? err.message : err)));
        }
      });
    },

    /* Converte testo incollato da Excel (TSV) in { headers, rows }.
       Righe separate da \n, celle separate da TAB. Prima riga = headers. */
    fromTSV: function (text) {
      if (text === null || text === undefined) return { headers: [], rows: [] };

      // Normalizza i fine riga e rimuove un eventuale newline finale.
      var normalized = String(text).replace(/\r\n|\r/g, '\n');
      normalized = normalized.replace(/\n+$/, '');
      if (normalized === '') return { headers: [], rows: [] };

      var lines = normalized.split('\n');
      var matrix = [];
      for (var i = 0; i < lines.length; i++) {
        matrix.push(lines[i].split('\t'));
      }

      return matrixToTable(matrix);
    },

    /* Euristica: il testo "sembra" una tabella incollata da Excel se
       contiene almeno un TAB e piu' di una riga (oppure una sola riga
       con piu' celle separate da TAB). */
    isTSV: function (text) {
      if (text === null || text === undefined) return false;
      var s = String(text);
      if (s.indexOf('\t') === -1) return false;

      var normalized = s.replace(/\r\n|\r/g, '\n').replace(/\n+$/, '');
      if (normalized === '') return false;

      var lines = normalized.split('\n');
      // Piu' righe con TAB, oppure una riga con almeno due celle.
      if (lines.length > 1) return true;
      return lines[0].split('\t').length > 1;
    },

    /* Produce il blocco markdown nel formato dell'app.
       table = { headers, rows }; opts opzionale = { title }. */
    toMarkdown: function (table, opts) {
      table = table || {};
      opts = opts || {};

      var headers = Array.isArray(table.headers) ? table.headers : [];
      var rows = Array.isArray(table.rows) ? table.rows : [];

      // Numero di colonne: massimo tra headers e tutte le righe.
      var cols = headers.length;
      for (var r = 0; r < rows.length; r++) {
        var len = (rows[r] || []).length;
        if (len > cols) cols = len;
      }

      // Costruisce una riga markdown "| a | b |" da un array di celle.
      function mdRow(cells) {
        var parts = [];
        for (var c = 0; c < cols; c++) {
          parts.push(escapeCell((cells || [])[c]));
        }
        return '| ' + parts.join(' | ') + ' |';
      }

      var out = ':: table\n';
      if (opts.title) {
        out += '# ' + String(opts.title) + '\n';
      }

      if (cols === 0) {
        // Tabella vuota: ritorna comunque un blocco valido (header vuoto).
        return out + '|  |\n| --- |';
      }

      // Riga header.
      out += mdRow(headers) + '\n';

      // Riga separatore "| --- | --- |".
      var sep = [];
      for (var s = 0; s < cols; s++) sep.push('---');
      out += '| ' + sep.join(' | ') + ' |';

      // Righe dati.
      for (var i = 0; i < rows.length; i++) {
        out += '\n' + mdRow(rows[i]);
      }

      return out;
    }
  };

  // Esposizione sul namespace globale.
  window.OFG.tables = tables;

})();
