/* ============================================================
   project.js — Salvataggio/apertura progetto OFG
   Permette di salvare l'intero lavoro (markdown + immagini +
   impostazioni) come singolo file .ofg e di riaprirlo in seguito,
   cosi' l'utente puo' riprendere senza perdere le foto.
   Il file .ofg e' semplicemente JSON.
   Nessuna dipendenza esterna.
   ============================================================ */
(function () {
  'use strict';

  window.OFG = window.OFG || {};

  // ----------------------------------------------------------
  // Costanti
  // ----------------------------------------------------------
  var APP_TAG = 'ofg-slide-builder'; // marcatore applicazione
  var VERSION = 1;                   // versione del formato file
  var EXT = '.ofg';                  // estensione dei file di progetto

  var VALID_MODES = ['deck', 'landing'];
  var VALID_THEMES = ['auto', 'light', 'dark'];
  var DEFAULT_MODE = 'deck';
  var DEFAULT_THEME = 'auto';

  // ----------------------------------------------------------
  // Helper interni
  // ----------------------------------------------------------

  // Restituisce una stringa "pulita" oppure '' se il valore non e' una stringa.
  function asString(value) {
    return (typeof value === 'string') ? value : '';
  }

  // Normalizza il "mode": deve essere tra quelli ammessi, altrimenti default.
  function normalizeMode(value) {
    return (VALID_MODES.indexOf(value) !== -1) ? value : DEFAULT_MODE;
  }

  // Normalizza il "theme": deve essere tra quelli ammessi, altrimenti default.
  function normalizeTheme(value) {
    return (VALID_THEMES.indexOf(value) !== -1) ? value : DEFAULT_THEME;
  }

  // Normalizza l'array immagini: tiene solo elementi validi con
  // {id, name, dataUri} dove id e dataUri sono stringhe non vuote.
  // I campi vengono ridotti esattamente a {id, name, dataUri}.
  function normalizeImages(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    var out = [];
    for (var i = 0; i < value.length; i++) {
      var img = value[i];
      if (!img || typeof img !== 'object') {
        continue;
      }
      var id = asString(img.id);
      var dataUri = asString(img.dataUri);
      // id e dataUri sono indispensabili: senza non e' un'immagine utile.
      if (!id || !dataUri) {
        continue;
      }
      out.push({
        id: id,
        name: asString(img.name),
        dataUri: dataUri
      });
    }
    return out;
  }

  // Aggiunge l'estensione .ofg al filename se mancante.
  function ensureExtension(filename) {
    var name = asString(filename).trim();
    if (!name) {
      name = 'progetto' + EXT;
    } else if (name.slice(-EXT.length).toLowerCase() !== EXT) {
      name += EXT;
    }
    return name;
  }

  // ----------------------------------------------------------
  // API pubblica
  // ----------------------------------------------------------

  // serialize(state) -> string
  // Produce il JSON del progetto nella forma documentata.
  function serialize(state) {
    var s = (state && typeof state === 'object') ? state : {};
    var project = {
      app: APP_TAG,
      version: VERSION,
      savedAt: new Date().toISOString(),
      markdown: asString(s.markdown),
      mode: normalizeMode(s.mode),
      theme: normalizeTheme(s.theme),
      images: normalizeImages(s.images)
    };
    // Indentazione a 2 spazi: file leggibile e diff-friendly.
    return JSON.stringify(project, null, 2);
  }

  // download(state, filename) -> void
  // Serializza lo stato e avvia il download di un file .ofg.
  function download(state, filename) {
    var json = serialize(state);
    var name = ensureExtension(filename);

    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    // Aggiungere al DOM rende il click affidabile su tutti i browser.
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoca dell'URL dopo il click per liberare memoria.
    // Il piccolo ritardo evita di invalidare l'URL prima che parta il download.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }

  // open(file) -> Promise<state>
  // Legge un File (.ofg o .json), valida e normalizza il progetto.
  // Rigetta con Error chiaro se non e' JSON valido o non e' un progetto.
  function open(file) {
    return new Promise(function (resolve, reject) {
      if (!file || typeof file.text !== 'function' && typeof FileReader === 'undefined') {
        reject(new Error('Nessun file valido da aprire.'));
        return;
      }

      // Lettura del File come testo. Usa FileReader per massima compatibilita'.
      var reader = new FileReader();

      reader.onerror = function () {
        reject(new Error('Impossibile leggere il file.'));
      };

      reader.onload = function () {
        var text = reader.result;
        var data;

        // 1) Parsing JSON difensivo.
        try {
          data = JSON.parse(text);
        } catch (e) {
          reject(new Error('Il file non e’ un progetto OFG valido (JSON non valido).'));
          return;
        }

        // 2) Deve essere un oggetto (non array, non null).
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          reject(new Error('Il file non e’ un progetto OFG valido.'));
          return;
        }

        // 3) Il campo markdown deve essere una stringa.
        //    E' l'unico requisito forte: tutto il resto ha default.
        if (typeof data.markdown !== 'string') {
          reject(new Error('Il file non e’ un progetto OFG valido (manca il testo).'));
          return;
        }

        // 4) Normalizzazione tollerante verso versioni con campi mancanti.
        resolve({
          markdown: data.markdown,
          mode: normalizeMode(data.mode),
          theme: normalizeTheme(data.theme),
          images: normalizeImages(data.images)
        });
      };

      try {
        reader.readAsText(file);
      } catch (e) {
        reject(new Error('Impossibile leggere il file.'));
      }
    });
  }

  // ----------------------------------------------------------
  // Esposizione su window.OFG
  // ----------------------------------------------------------
  window.OFG.project = {
    serialize: serialize,
    download: download,
    open: open
  };
})();
