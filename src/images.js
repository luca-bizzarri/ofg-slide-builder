/* ============================================================
   images.js — Libreria immagini OFG
   Gestisce uno "store" in memoria delle immagini caricate
   dall'utente (compressione via canvas), con persistenza in
   localStorage e una galleria di thumbnail.
   Le immagini sono referenziate nel markdown col token "img:ID".
   Nessuna dipendenza esterna.
   ============================================================ */
(function () {
  'use strict';

  window.OFG = window.OFG || {};

  // ----------------------------------------------------------
  // Costanti di configurazione
  // ----------------------------------------------------------
  var STORAGE_KEY = 'ofg.images.v1';
  var MAX_SIDE = 1600;            // lato massimo (px) dopo compressione
  var JPEG_QUALITY = 0.82;        // qualita' JPEG di partenza
  var TARGET_BYTES = 400 * 1024;  // ~400KB target per singola immagine
  var QUOTA_GUARD = 4.5 * 1024 * 1024; // guard totale ~4.5MB in localStorage

  // ----------------------------------------------------------
  // Stato interno
  // ----------------------------------------------------------
  var store = [];          // array di { id, name, dataUri } in ordine d'inserimento
  var nextId = 1;          // contatore id crescente
  var listeners = [];      // callback notificate ad ogni cambiamento dello store

  // ----------------------------------------------------------
  // Persistenza
  // ----------------------------------------------------------

  // Carica lo store dal localStorage (best-effort, tollerante agli errori).
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      store = parsed.filter(function (it) {
        return it && it.id != null && typeof it.dataUri === 'string';
      }).map(function (it) {
        return { id: String(it.id), name: String(it.name || ''), dataUri: it.dataUri };
      });
      // Ricalcola il prossimo id sulla base degli id numerici esistenti.
      var maxId = 0;
      store.forEach(function (it) {
        var n = parseInt(it.id, 10);
        if (!isNaN(n) && n > maxId) maxId = n;
      });
      nextId = maxId + 1;
    } catch (err) {
      console.warn('[OFG.images] Impossibile leggere lo store dal localStorage:', err);
    }
  }

  // Persiste lo store nel localStorage; non crasha in caso di quota superata.
  function persist() {
    var json;
    try {
      json = JSON.stringify(store);
    } catch (err) {
      console.warn('[OFG.images] Serializzazione store fallita:', err);
      return;
    }
    // Guard totale: se superiamo la soglia, evitiamo di scrivere e
    // manteniamo tutto solo in memoria.
    if (json.length > QUOTA_GUARD) {
      console.warn('[OFG.images] Store oltre la guard (~4.5MB): mantengo solo in memoria, niente persistenza.');
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch (err) {
      // QuotaExceededError (o simili): non crashiamo, restiamo in memoria.
      console.warn('[OFG.images] Quota localStorage superata: immagini mantenute solo in memoria.', err);
    }
  }

  // Notifica i listener (es. la galleria) di un cambiamento.
  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { /* un listener rotto non deve bloccare gli altri */ }
    });
  }

  function subscribe(fn) {
    if (typeof fn === 'function' && listeners.indexOf(fn) === -1) listeners.push(fn);
  }

  function unsubscribe(fn) {
    var i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  }

  // ----------------------------------------------------------
  // Compressione immagine via canvas
  // ----------------------------------------------------------

  // Legge un File come dataURI.
  function readFileAsDataUri(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Lettura del file fallita: ' + (file && file.name ? file.name : 'sconosciuto'))); };
      reader.readAsDataURL(file);
    });
  }

  // Carica un dataURI in un oggetto Image.
  function loadImage(dataUri) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Impossibile caricare l'immagine (formato non valido o file corrotto).")); };
      img.src = dataUri;
    });
  }

  // Comprime un'immagine gia' caricata: ridimensiona mantenendo le
  // proporzioni (senza ingrandire) e riduce la qualita' JPEG finche'
  // non rientra nel target di dimensione (con un minimo ragionevole).
  function compressImage(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;

    if (!w || !h) {
      throw new Error("Dimensioni dell'immagine non valide.");
    }

    // Calcola la scala: riduce solo se eccede il lato massimo.
    var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    var tw = Math.max(1, Math.round(w * scale));
    var th = Math.max(1, Math.round(h * scale));

    var canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    var ctx = canvas.getContext('2d');
    // Fondo bianco: evita aloni neri su PNG con trasparenza convertiti in JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(img, 0, 0, tw, th);

    // Tenta qualita' decrescenti per rientrare nel target.
    var quality = JPEG_QUALITY;
    var dataUri = canvas.toDataURL('image/jpeg', quality);
    while (dataUriBytes(dataUri) > TARGET_BYTES && quality > 0.4) {
      quality -= 0.1;
      dataUri = canvas.toDataURL('image/jpeg', quality);
    }
    return dataUri;
  }

  // Stima i byte reali di un dataURI (la parte base64).
  function dataUriBytes(dataUri) {
    var comma = dataUri.indexOf(',');
    var b64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
    // Ogni 4 char base64 = 3 byte; correzione per il padding "=".
    var padding = (b64.charAt(b64.length - 1) === '=' ? 1 : 0) + (b64.charAt(b64.length - 2) === '=' ? 1 : 0);
    return Math.floor(b64.length * 3 / 4) - padding;
  }

  // ----------------------------------------------------------
  // CRUD dello store
  // ----------------------------------------------------------

  function makeId() {
    return String(nextId++);
  }

  function pushItem(name, dataUri) {
    var id = makeId();
    store.push({ id: id, name: String(name || ''), dataUri: dataUri });
    persist();
    notify();
    return id;
  }

  // ----------------------------------------------------------
  // API pubblica
  // ----------------------------------------------------------

  // Aggiunge un File immagine: lo comprime, lo salva e ritorna l'id.
  function add(file) {
    return new Promise(function (resolve, reject) {
      if (!file || (file.type && file.type.indexOf('image/') !== 0)) {
        reject(new Error('Il file selezionato non e\' un\'immagine.'));
        return;
      }
      readFileAsDataUri(file)
        .then(loadImage)
        .then(function (img) {
          var compressed = compressImage(img);
          var id = pushItem(file.name || 'immagine', compressed);
          resolve(id);
        })
        .catch(function (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  // Aggiunge un'immagine gia' in dataURI (usata dall'import pptx).
  function addDataUri(dataUri, name) {
    if (typeof dataUri !== 'string' || dataUri.indexOf('data:') !== 0) {
      throw new Error('addDataUri richiede un dataURI valido.');
    }
    return pushItem(name, dataUri);
  }

  // Ritorna l'elemento con l'id dato (o undefined).
  function get(id) {
    var key = String(id);
    for (var i = 0; i < store.length; i++) {
      if (store[i].id === key) return store[i];
    }
    return undefined;
  }

  // Risolve un riferimento immagine in una stringa usabile come img.src.
  function resolve(ref) {
    if (!ref || typeof ref !== 'string') return null;
    var trimmed = ref.trim();
    if (trimmed === '') return null;
    if (trimmed.indexOf('img:') === 0) {
      var item = get(trimmed.slice(4));
      return item ? item.dataUri : null;
    }
    // http(s):, data:, o un path qualsiasi -> ritornato invariato.
    return ref;
  }

  // Ritorna tutte le immagini in ordine di inserimento (copia shallow).
  function all() {
    return store.map(function (it) {
      return { id: it.id, name: it.name, dataUri: it.dataUri };
    });
  }

  // Rimuove l'immagine con l'id dato e persiste.
  function remove(id) {
    var key = String(id);
    var idx = -1;
    for (var i = 0; i < store.length; i++) {
      if (store[i].id === key) { idx = i; break; }
    }
    if (idx !== -1) {
      store.splice(idx, 1);
      persist();
      notify();
    }
  }

  // Svuota lo store e persiste.
  function clear() {
    store = [];
    persist();
    notify();
  }

  // ----------------------------------------------------------
  // Galleria thumbnail (mountGallery)
  // ----------------------------------------------------------

  function truncateName(name, max) {
    name = String(name || 'immagine');
    if (name.length <= max) return name;
    return name.slice(0, max - 1) + '…';
  }

  // Monta la galleria nella container indicata. Si auto-aggiorna ad
  // ogni cambiamento dello store tramite un listener interno.
  function mountGallery(containerEl, opts) {
    if (!containerEl) {
      console.warn('[OFG.images] mountGallery: container mancante.');
      return;
    }
    opts = opts || {};
    var onInsert = typeof opts.onInsert === 'function' ? opts.onInsert : function () {};

    // Costruisce la struttura statica una sola volta.
    containerEl.classList.add('imglib');
    containerEl.innerHTML = '';

    // Dropzone / etichetta + input file nascosto.
    var drop = document.createElement('label');
    drop.className = 'imglib__drop';
    drop.innerHTML = '<span class="imglib__drop-text">Trascina qui le foto</span>';

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.className = 'imglib__input';
    drop.appendChild(input);

    var grid = document.createElement('div');
    grid.className = 'imglib__grid';

    containerEl.appendChild(drop);
    containerEl.appendChild(grid);

    // Gestione caricamento di una lista di File.
    function handleFiles(fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      files.forEach(function (f) {
        if (f && f.type && f.type.indexOf('image/') === 0) {
          add(f).catch(function (err) {
            console.warn('[OFG.images] Aggiunta immagine fallita:', err && err.message ? err.message : err);
          });
        }
      });
    }

    // Input file (click).
    input.addEventListener('change', function () {
      handleFiles(input.files);
      input.value = ''; // consente di ricaricare lo stesso file
    });

    // Drag & drop.
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add('imglib__drop--active');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove('imglib__drop--active');
      });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });

    // Render della griglia delle thumbnail.
    function renderGrid() {
      grid.innerHTML = '';
      var items = all();
      if (items.length === 0) {
        var empty = document.createElement('p');
        empty.className = 'imglib__empty';
        empty.textContent = 'Nessuna immagine caricata.';
        grid.appendChild(empty);
        return;
      }
      items.forEach(function (it) {
        var item = document.createElement('div');
        item.className = 'imglib__item';
        item.title = it.name;

        var thumb = document.createElement('img');
        thumb.className = 'imglib__thumb';
        thumb.src = it.dataUri;
        thumb.alt = it.name;
        thumb.loading = 'lazy';
        thumb.addEventListener('click', function () { onInsert(it.id); });

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'imglib__del';
        del.setAttribute('aria-label', 'Elimina immagine');
        del.textContent = '✕'; // ✕
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          remove(it.id);
        });

        var label = document.createElement('span');
        label.className = 'imglib__name';
        label.textContent = truncateName(it.name, 18);

        item.appendChild(thumb);
        item.appendChild(del);
        item.appendChild(label);
        grid.appendChild(item);
      });
    }

    // Primo render + sottoscrizione agli aggiornamenti dello store.
    renderGrid();
    subscribe(renderGrid);
  }

  // ----------------------------------------------------------
  // Inizializzazione + esposizione su window.OFG
  // ----------------------------------------------------------
  load();

  OFG.images = {
    add: add,
    addDataUri: addDataUri,
    get: get,
    resolve: resolve,
    all: all,
    remove: remove,
    clear: clear,
    mountGallery: mountGallery
  };
})();
