/* ============================================================
   editor.js — Logica dell'interfaccia Slide Builder OFG
   --------------------------------------------------------------
   App 100% client-side, nessuna dipendenza. Orchestra la pipeline:

     textarea markdown
        │ (input, debounce ~220ms)
        ▼
     OFG.parse(md) -> Slide[]
        │
        ▼
     OFG.renderDeck(container, slides, {mode}) -> DOM
        │
        ▼
     (ri)crea OFG.Engine(container, {mode, onChange})

   Gestisce inoltre:
     - caricamento file .md (input file + drag&drop sul pannello);
     - toggle modalita' deck/landing e tema globale dell'anteprima;
     - conteggio slide + segnalazione del tipo per ogni blocco;
     - autosave del sorgente in localStorage;
     - bottone "Esporta HTML" -> OFG.downloadHTML;
     - gestione errori di parsing mostrata con gentilezza.

   Dipende dal markup di index.html (vedi gli ID usati sotto). Se
   un elemento manca, l'editor degrada senza lanciare eccezioni.

   API PUBBLICA (window.OFG):
     OFG.Editor.init(opts?) -> istanza editor
       opts = { root?: HTMLElement|selector }  (default: document)
   ============================================================ */

(function (global) {
  'use strict';

  var OFG = (global.OFG = global.OFG || {});
  var document = global.document;

  /* Chiave per l'autosave del sorgente. */
  var STORAGE_KEY = 'ofg-slide-builder:source';

  /* Markdown di partenza se non c'e' nulla salvato e nessun sample. */
  var STARTER_MD = [
    ':: cover',
    '# LA TUA PRESENTAZIONE',
    '## Scrivi qui il markdown · anteprima a destra',
    '',
    '---',
    '',
    ':: bullets',
    '# Come funziona',
    '- Una slide per blocco, separati da `---`',
    '- Tipo con `:: tipo` (cover, text, kpi, quote…)',
    '- ==Modifica== e guarda l\'anteprima aggiornarsi'
  ].join('\n');

  /* Blocco tabella d'esempio inserito dal bottone "+ Tabella". */
  var SAMPLE_TABLE_MD = [
    ':: table',
    '# Tabella d\'esempio',
    '| Colonna A | Colonna B | Colonna C |',
    '| --- | --- | --- |',
    '| Valore 1 | Valore 2 | Valore 3 |',
    '| Valore 4 | Valore 5 | Valore 6 |'
  ].join('\n');

  /* --------------------------------------------------------
     UTILITY
     -------------------------------------------------------- */

  /* Debounce: ritarda fn finche' non passano `wait` ms di quiete. */
  function debounce(fn, wait) {
    var t = 0;
    return function () {
      var ctx = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = 0; fn.apply(ctx, args); }, wait);
    };
  }

  /* querySelector sicuro su una radice. */
  function q(root, sel) {
    return root ? root.querySelector(sel) : null;
  }

  /* localStorage difensivo (puo' lanciare in modalita' privata/file://). */
  function lsGet(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { global.localStorage.setItem(key, val); } catch (e) { /* no-op */ }
  }

  /* --------------------------------------------------------
     EDITOR
     -------------------------------------------------------- */

  function Editor(opts) {
    if (!(this instanceof Editor)) return new Editor(opts);
    opts = opts || {};

    var root = opts.root;
    if (typeof root === 'string') root = document.querySelector(root);
    this.root = root || document;

    /* Stato corrente. */
    this.mode = 'deck';          // 'deck' | 'landing'
    this.theme = 'auto';         // 'auto' | 'light' | 'dark' (override globale)
    this.slides = [];            // ultimi modelli parse-ati
    this.engine = null;          // istanza OFG.Engine corrente
    this.layout = false;         // modalita' di lavoro visuale (ritaglio/drop foto)
    this._noticeTimer = 0;

    this._cacheDom();
    this._bind();
    this._boot();
  }

  /* Raccoglie i riferimenti DOM (tutti opzionali: degrada se mancano). */
  Editor.prototype._cacheDom = function () {
    var r = this.root;
    this.elSource = q(r, '#source');
    this.elPanelSource = q(r, '#panel-source') || (this.elSource && this.elSource.closest('.panel-source'));
    this.elPreview = q(r, '#preview-deck');
    this.elPanelPreview = this.elPreview && this.elPreview.closest('.panel-preview');
    this.elCount = q(r, '#slide-count');
    this.elNotice = q(r, '#notice');
    this.elEmpty = q(r, '#preview-empty');

    this.elFileInput = q(r, '#file-input');
    this.elBtnExport = q(r, '#btn-export');
    this.elPptxInput = q(r, '#pptx-input');
    this.elGallery = q(r, '#image-gallery');

    /* Nuovi controlli: import Excel, +Tabella, toggle Layout, striscia riordino. */
    this.elXlsxInput = q(r, '#xlsx-input');
    this.elBtnAddTable = q(r, '#btn-add-table');
    this.elBtnLayout = q(r, '#btn-layout');
    this.elStrip = q(r, '#slide-strip');

    /* Toggle a segmenti modalita' e tema. */
    this.modeBtns = r.querySelectorAll
      ? Array.prototype.slice.call(r.querySelectorAll('[data-mode]'))
      : [];
    this.themeBtns = r.querySelectorAll
      ? Array.prototype.slice.call(r.querySelectorAll('[data-theme-opt]'))
      : [];
  };

  /* Collega tutti gli event listener. */
  Editor.prototype._bind = function () {
    var self = this;

    /* --- Editing live (debounce) --- */
    if (this.elSource) {
      var onInput = debounce(function () { self._render(); self._persist(); }, 220);
      this.elSource.addEventListener('input', onInput);
    }

    /* --- Caricamento file via input --- */
    if (this.elFileInput) {
      this.elFileInput.addEventListener('change', function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (file) self._loadFile(file);
        /* Reset cosi' si puo' ricaricare lo stesso file. */
        ev.target.value = '';
      });
    }

    /* --- Drag & drop sul pannello sorgente --- */
    if (this.elPanelSource) {
      var panel = this.elPanelSource;
      var stop = function (e) { e.preventDefault(); e.stopPropagation(); };
      ['dragenter', 'dragover'].forEach(function (t) {
        panel.addEventListener(t, function (e) {
          stop(e);
          panel.classList.add('is-dragover');
        });
      });
      ['dragleave', 'dragend'].forEach(function (t) {
        panel.addEventListener(t, function (e) {
          stop(e);
          panel.classList.remove('is-dragover');
        });
      });
      panel.addEventListener('drop', function (e) {
        stop(e);
        panel.classList.remove('is-dragover');
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) self._handleDroppedFiles(files);
      });
    }

    /* --- Importa PPTX (anche da Google Slides esportato in .pptx) --- */
    if (this.elPptxInput) {
      this.elPptxInput.addEventListener('change', function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (file) self._importPptx(file);
        ev.target.value = '';
      });
    }

    /* --- Incolla immagini dagli appunti direttamente nella textarea --- */
    if (this.elSource) {
      this.elSource.addEventListener('paste', function (ev) {
        var items = ev.clipboardData && ev.clipboardData.items;
        if (!items) return;
        var imgs = [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
            var f = items[i].getAsFile();
            if (f) imgs.push(f);
          }
        }
        if (imgs.length) {
          ev.preventDefault();
          self._addImageFiles(imgs);
          return;
        }
        /* Niente immagini: se il testo incollato sembra una tabella Excel
           (TSV), lo convertiamo in un blocco ':: table'. */
        if (OFG.tables && OFG.tables.isTSV) {
          var text = ev.clipboardData.getData ? ev.clipboardData.getData('text/plain') : '';
          if (text && OFG.tables.isTSV(text)) {
            ev.preventDefault();
            try {
              var table = OFG.tables.fromTSV(text);
              var block = OFG.tables.toMarkdown(table, {});
              self._appendBlock(block);
              self._showNotice('info', 'Tabella incollata da Excel.');
            } catch (e) {
              self._showNotice('error', 'Impossibile interpretare la tabella incollata.');
            }
          }
        }
      });
    }

    /* --- Toggle modalita' --- */
    this.modeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        self.setMode(btn.getAttribute('data-mode'));
      });
    });

    /* --- Toggle tema globale --- */
    this.themeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        self.setTheme(btn.getAttribute('data-theme-opt'));
      });
    });

    /* --- Export --- */
    if (this.elBtnExport) {
      this.elBtnExport.addEventListener('click', function () { self._export(); });
    }

    /* --- Importa Excel/CSV via input --- */
    if (this.elXlsxInput) {
      this.elXlsxInput.addEventListener('change', function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (file) self._importTable(file);
        ev.target.value = '';
      });
    }

    /* --- Bottone "+ Tabella": inserisce un blocco d'esempio --- */
    if (this.elBtnAddTable) {
      this.elBtnAddTable.addEventListener('click', function () {
        self._appendBlock(SAMPLE_TABLE_MD);
        self._showNotice('info', 'Tabella d\'esempio aggiunta.');
      });
    }

    /* --- Toggle modalita' Layout --- */
    if (this.elBtnLayout) {
      this.elBtnLayout.addEventListener('click', function () { self._toggleLayout(); });
    }

    /* --- Modalita' Layout: click su immagine + drop foto sulle slide
       dell'anteprima. I listener stanno sul contenitore: delegano in
       base al target/closest('[data-index]'). Attivi solo se layout=on. --- */
    if (this.elPreview) {
      this.elPreview.addEventListener('click', function (e) {
        if (!self.layout) return;
        self._onPreviewClick(e);
      });
      var stopPv = function (e) { e.preventDefault(); e.stopPropagation(); };
      ['dragenter', 'dragover'].forEach(function (t) {
        self.elPreview.addEventListener(t, function (e) {
          if (!self.layout) return;
          stopPv(e);
          var slide = e.target && e.target.closest && e.target.closest('[data-index]');
          if (slide) slide.classList.add('is-drop-target');
        });
      });
      self.elPreview.addEventListener('dragleave', function (e) {
        if (!self.layout) return;
        var slide = e.target && e.target.closest && e.target.closest('[data-index]');
        if (slide) slide.classList.remove('is-drop-target');
      });
      self.elPreview.addEventListener('drop', function (e) {
        if (!self.layout) return;
        stopPv(e);
        self._onPreviewDrop(e);
      });
    }
  };

  /* Avvio: carica il sorgente (autosave > sample esterno > starter)
     e disegna la prima anteprima. */
  Editor.prototype._boot = function () {
    var saved = lsGet(STORAGE_KEY);
    if (this.elSource) {
      if (saved != null && saved !== '') {
        this.elSource.value = saved;
        this._render();
      } else {
        /* Prova a caricare samples/esempio.md; se non c'e', usa lo starter. */
        this._tryLoadSample();
      }
    }
    this._syncControls();
    this._mountGallery();
    /* Inizializza la striscia di riordino anche dopo il primo boot
       (il render l'ha gia' costruita, qui garantiamo lo stato). */
    this._renderStrip();
  };

  /* Carica il sample dimostrativo (best-effort). */
  Editor.prototype._tryLoadSample = function () {
    var self = this;
    if (!global.fetch) {
      this.elSource.value = STARTER_MD;
      this._render();
      return;
    }
    global.fetch('./samples/esempio.md')
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) {
        self.elSource.value = (txt && txt.trim()) ? txt : STARTER_MD;
        self._render();
      })
      .catch(function () {
        self.elSource.value = STARTER_MD;
        self._render();
      });
  };

  /* --------------------------------------------------------
     PIPELINE: parse -> render -> engine
     -------------------------------------------------------- */

  Editor.prototype._render = function () {
    if (!this.elSource || !this.elPreview) return;
    var md = this.elSource.value;

    /* 1) Parse (il parser non lancia mai, ma proteggiamo comunque). */
    var slides;
    try {
      slides = OFG.parse ? OFG.parse(md) : [];
    } catch (err) {
      this._showNotice('error', 'Errore inatteso durante la lettura del markdown.');
      return;
    }
    this.slides = Array.isArray(slides) ? slides : [];

    /* 1b) Ricostruisci la striscia di riordino (sempre, anche se 0 slide). */
    this._renderStrip();

    /* 2) Applica eventuale override di tema globale (auto = lascia
       il tema risolto dal parser per ogni slide). */
    var effective = this._applyThemeOverride(this.slides);

    /* 3) Aggiorna conteggio + stato vuoto. */
    this._updateCount(effective.length);
    this._toggleEmpty(effective.length === 0);

    /* 4) Distruggi l'engine precedente (listener/observer puliti). */
    if (this.engine && this.engine.destroy) {
      try { this.engine.destroy(); } catch (e) { /* no-op */ }
      this.engine = null;
    }

    if (effective.length === 0) {
      /* Svuota l'anteprima ma lascia lo stato vuoto visibile. */
      if (OFG.renderDeck) OFG.renderDeck(this.elPreview, [], { mode: this.mode });
      this._clearNotice();
      return;
    }

    /* 5) Render + engine. Usiamo OFG.init quando disponibile. */
    var self = this;
    try {
      if (OFG.init) {
        this.engine = OFG.init(this.elPreview, effective, {
          mode: this.mode,
          onChange: function (st) { self._onSlideChange(st); }
        });
      } else if (OFG.renderDeck && OFG.Engine) {
        OFG.renderDeck(this.elPreview, effective, { mode: this.mode });
        this.engine = new OFG.Engine(this.elPreview, {
          mode: this.mode,
          onChange: function (st) { self._onSlideChange(st); }
        });
      }
      this._clearNotice();
    } catch (err) {
      this._showNotice('error',
        'Anteprima non disponibile: ' + (err && err.message ? err.message : 'errore di rendering') + '.');
    }
  };

  /* Applica l'override globale di tema senza mutare i modelli originali:
     se theme='auto' ritorna i modelli invariati; altrimenti clona e
     forza il tema richiesto su tutte le slide. */
  Editor.prototype._applyThemeOverride = function (slides) {
    if (this.theme === 'auto') return slides;
    var forced = this.theme === 'dark' ? 'dark' : 'light';
    var out = [];
    for (var i = 0; i < slides.length; i++) {
      var s = slides[i];
      var clone = {};
      for (var k in s) {
        if (Object.prototype.hasOwnProperty.call(s, k)) clone[k] = s[k];
      }
      clone.theme = forced;
      out.push(clone);
    }
    return out;
  };

  /* Callback al cambio slide: niente UI extra obbligatoria, ma utile
     per estensioni future (qui aggiorniamo solo un eventuale attr). */
  Editor.prototype._onSlideChange = function (state) {
    if (this.elPanelPreview) {
      this.elPanelPreview.setAttribute('data-active-index', String(state.index));
    }
  };

  /* --------------------------------------------------------
     MODALITA' / TEMA
     -------------------------------------------------------- */

  Editor.prototype.setMode = function (mode) {
    mode = (mode === 'landing') ? 'landing' : 'deck';
    if (mode === this.mode) return;
    this.mode = mode;
    this._syncControls();
    /* Ricostruisce render+engine per la nuova modalita'. */
    this._render();
  };

  Editor.prototype.setTheme = function (theme) {
    if (theme !== 'light' && theme !== 'dark') theme = 'auto';
    if (theme === this.theme) return;
    this.theme = theme;
    this._syncControls();
    this._render();
  };

  /* Aggiorna lo stato visivo (is-active) dei toggle a segmenti. */
  Editor.prototype._syncControls = function () {
    var self = this;
    this.modeBtns.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-mode') === self.mode);
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-mode') === self.mode));
    });
    this.themeBtns.forEach(function (btn) {
      var on = btn.getAttribute('data-theme-opt') === self.theme;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  };

  /* --------------------------------------------------------
     CARICAMENTO FILE
     -------------------------------------------------------- */

  Editor.prototype._loadFile = function (file) {
    var self = this;
    var name = (file.name || '').toLowerCase();
    /* Accettiamo .md / .markdown / .txt; avvisiamo altrimenti. */
    if (!/\.(md|markdown|txt)$/.test(name)) {
      this._showNotice('info',
        'Tipo file inatteso: provo comunque a leggerlo come markdown.');
    }
    var reader = new FileReader();
    reader.onload = function () {
      if (self.elSource) {
        self.elSource.value = String(reader.result || '');
        self._render();
        self._persist();
        self._showNotice('info', 'File "' + (file.name || 'senza nome') + '" caricato.');
      }
    };
    reader.onerror = function () {
      self._showNotice('error', 'Impossibile leggere il file selezionato.');
    };
    reader.readAsText(file);
  };

  /* --------------------------------------------------------
     IMMAGINI (store + galleria) e IMPORT PPTX
     -------------------------------------------------------- */

  /* Smista i file trascinati nel pannello in base al tipo:
     immagini -> store, .pptx -> import, altro -> markdown. */
  Editor.prototype._handleDroppedFiles = function (fileList) {
    var files = Array.prototype.slice.call(fileList);
    var images = [], md = null, pptx = null, sheet = null;
    for (var i = 0; i < files.length; i++) {
      var n = (files[i].name || '').toLowerCase();
      if (/^image\//.test(files[i].type) || /\.(png|jpe?g|gif|webp|svg|avif)$/.test(n)) {
        images.push(files[i]);
      } else if (/\.pptx$/.test(n)) {
        pptx = pptx || files[i];
      } else if (/\.(xlsx|xls|csv)$/.test(n)) {
        sheet = sheet || files[i];
      } else {
        md = md || files[i]; // .md/.txt o sconosciuto: tentiamo come markdown
      }
    }
    if (pptx) { this._importPptx(pptx); return; }
    if (sheet) { this._importTable(sheet); return; }
    if (images.length) { this._addImageFiles(images); return; }
    if (md) this._loadFile(md);
  };

  /* Aggiunge una o piu' immagini allo store e inserisce i token nel testo. */
  Editor.prototype._addImageFiles = function (files) {
    var self = this;
    if (!OFG.images || !OFG.images.add) {
      this._showNotice('error', 'Modulo immagini non disponibile.');
      return;
    }
    var queue = Array.prototype.slice.call(files);
    var added = 0;
    function next() {
      if (!queue.length) {
        if (added) {
          self._render();
          self._persist();
          self._showNotice('info',
            added + (added === 1 ? ' immagine aggiunta' : ' immagini aggiunte') + ' e inserita nel testo.');
        }
        return;
      }
      var f = queue.shift();
      OFG.images.add(f).then(function (id) {
        self._insertImageToken(id);
        added++;
        next();
      }).catch(function (err) {
        self._showNotice('error',
          'Immagine non caricata: ' + (err && err.message ? err.message : 'errore') + '.');
        next();
      });
    }
    next();
  };

  /* Inserisce "![](img:ID)" alla posizione del cursore. */
  Editor.prototype._insertImageToken = function (id) {
    this._insertAtCursor('\n![](img:' + id + ')\n');
  };

  Editor.prototype._insertAtCursor = function (text) {
    var ta = this.elSource;
    if (!ta) return;
    var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    var end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    var pos = start + text.length;
    try { ta.setSelectionRange(pos, pos); ta.focus(); } catch (e) { /* no-op */ }
  };

  /* Monta la galleria immagini: click su una miniatura inserisce il token. */
  Editor.prototype._mountGallery = function () {
    var self = this;
    if (!this.elGallery || !OFG.images || !OFG.images.mountGallery) return;
    OFG.images.mountGallery(this.elGallery, {
      onInsert: function (id) {
        self._insertImageToken(id);
        self._render();
        self._persist();
      }
    });
  };

  /* Importa un .pptx (PowerPoint o Google Slides esportato in .pptx):
     estrae testo e immagini e sostituisce il sorgente col markdown generato. */
  Editor.prototype._importPptx = function (file) {
    var self = this;
    if (!OFG.importPptx) {
      this._showNotice('error', 'Modulo di import PPT non disponibile.');
      return;
    }
    this._showNotice('info',
      'Importazione di "' + (file.name || 'presentazione') + '" in corso…');
    OFG.importPptx(file).then(function (res) {
      if (self.elSource) {
        self.elSource.value = res.markdown || '';
        self._render();
        self._persist();
      }
      var msg = 'Importate ' + res.slideCount + (res.slideCount === 1 ? ' slide' : ' slide');
      if (res.imageCount) msg += ' e ' + res.imageCount + (res.imageCount === 1 ? ' immagine' : ' immagini');
      msg += '.';
      if (res.warnings && res.warnings.length) {
        msg += ' Non importati alcuni elementi (es. ' + res.warnings[0] + ').';
      }
      self._showNotice('info', msg);
    }).catch(function (err) {
      self._showNotice('error',
        'Import non riuscito: ' + (err && err.message ? err.message : 'file non valido') + '.');
    });
  };

  /* --------------------------------------------------------
     TABELLE (import Excel/CSV + inserimento blocco)
     -------------------------------------------------------- */

  /* Appende un blocco markdown gia' formattato come nuova slide in coda
     al sorgente, poi ri-renderizza e salva. Usa OFG.blocks.join quando
     disponibile (separatore canonico), altrimenti concatena a mano. */
  Editor.prototype._appendBlock = function (block) {
    if (!this.elSource || !block) return;
    var current = this.elSource.value;
    var next;
    if (OFG.blocks && OFG.blocks.split && OFG.blocks.join) {
      var blocks = OFG.blocks.split(current);
      /* Scarta un eventuale blocco vuoto finale per non lasciare buchi. */
      if (blocks.length === 1 && blocks[0].trim() === '') blocks = [];
      blocks.push(block);
      next = OFG.blocks.join(blocks);
    } else {
      next = current.trim() === '' ? block : (current + '\n\n---\n\n' + block);
    }
    this.elSource.value = next;
    this._render();
    this._persist();
  };

  /* Importa un foglio di calcolo (.xlsx/.xls/.csv) come blocco tabella:
     legge il primo foglio, lo converte in markdown ':: table' e lo
     appende come nuova slide. Degrada se il modulo manca. */
  Editor.prototype._importTable = function (file) {
    var self = this;
    if (!OFG.tables || !OFG.tables.fromFile || !OFG.tables.toMarkdown) {
      this._showNotice('error', 'Modulo tabelle non disponibile.');
      return;
    }
    this._showNotice('info',
      'Importazione di "' + (file.name || 'foglio') + '" in corso…');
    OFG.tables.fromFile(file).then(function (table) {
      /* Titolo = nome del file senza estensione. */
      var title = String(file.name || '').replace(/\.[^.]+$/, '');
      var block = OFG.tables.toMarkdown(table, { title: title });
      self._appendBlock(block);
      var nRows = (table.rows && table.rows.length) || 0;
      self._showNotice('info',
        'Tabella importata (' + nRows + (nRows === 1 ? ' riga' : ' righe') + ').');
    }).catch(function (err) {
      self._showNotice('error',
        'Import tabella non riuscito: ' + (err && err.message ? err.message : 'file non valido') + '.');
    });
  };

  /* --------------------------------------------------------
     MODALITA' LAYOUT (ritaglio foto + drop su slide)
     -------------------------------------------------------- */

  /* Attiva/disattiva la modalita' di lavoro visuale. Aggiunge la classe
     'is-layout' al contenitore anteprima (gli stili stanno in editor.css). */
  Editor.prototype._toggleLayout = function () {
    this.layout = !this.layout;
    if (this.elBtnLayout) {
      this.elBtnLayout.classList.toggle('is-active', this.layout);
      this.elBtnLayout.setAttribute('aria-pressed', String(this.layout));
    }
    if (this.elPreview) {
      this.elPreview.classList.toggle('is-layout', this.layout);
    }
    this._showNotice('info', this.layout
      ? 'Modalita\' Layout attiva: clicca una foto per inquadrarla, trascina una foto su una slide.'
      : 'Modalita\' Layout disattivata.');
  };

  /* Trova l'indice (data-index) della slide che contiene il nodo dato. */
  function slideIndexOf(node) {
    var slide = node && node.closest ? node.closest('[data-index]') : null;
    if (!slide) return -1;
    var idx = parseInt(slide.getAttribute('data-index'), 10);
    return isNaN(idx) ? -1 : idx;
  }

  /* Click in modalita' Layout: se su un'immagine (o sul suo media) apre
     il cropper per regolare l'inquadratura della foto di quella slide. */
  Editor.prototype._onPreviewClick = function (e) {
    var self = this;
    if (!OFG.Cropper || !OFG.Cropper.open || !OFG.blocks) return;
    var index = slideIndexOf(e.target);
    if (index < 0) return;

    /* Cerca un <img> dentro la slide cliccata. */
    var slide = e.target.closest('[data-index]');
    var imgEl = slide ? slide.querySelector('.media__img, img') : null;

    var info = OFG.blocks.getImage ? OFG.blocks.getImage(this.elSource.value, index) : null;
    if (!info) return; /* la slide non ha un'immagine da inquadrare */

    /* src per l'anteprima del cropper: usa quello renderizzato, oppure
       risolvi il riferimento via store immagini. */
    var src = imgEl && imgEl.src ? imgEl.src : '';
    if (!src && OFG.images && OFG.images.resolve) {
      src = OFG.images.resolve(info.ref) || '';
    }

    OFG.Cropper.open({
      src: src,
      opts: info.opts || {},
      onApply: function (o) {
        if (!self.elSource) return;
        var md = OFG.blocks.setImageOpts(self.elSource.value, index, o);
        self.elSource.value = md;
        self._render();
        self._persist();
      }
    });
  };

  /* Drop di una foto su una slide in modalita' Layout: imposta l'immagine
     di QUELLA slide. Sorgenti: file immagine (lo aggiunge allo store) o id
     trascinato dalla galleria (via dataTransfer text). */
  Editor.prototype._onPreviewDrop = function (e) {
    var self = this;
    var slide = e.target && e.target.closest ? e.target.closest('[data-index]') : null;
    if (slide) slide.classList.remove('is-drop-target');
    var index = slideIndexOf(e.target);
    if (index < 0 || !OFG.blocks || !OFG.blocks.setImage) return;

    var dt = e.dataTransfer;
    if (!dt) return;

    /* 1) File immagine trascinato dal sistema. */
    var files = dt.files;
    if (files && files.length) {
      var img = null;
      for (var i = 0; i < files.length; i++) {
        var n = (files[i].name || '').toLowerCase();
        if (/^image\//.test(files[i].type) || /\.(png|jpe?g|gif|webp|svg|avif)$/.test(n)) {
          img = files[i]; break;
        }
      }
      if (img && OFG.images && OFG.images.add) {
        OFG.images.add(img).then(function (id) {
          self._setSlideImage(index, 'img:' + id);
        }).catch(function (err) {
          self._showNotice('error',
            'Immagine non caricata: ' + (err && err.message ? err.message : 'errore') + '.');
        });
        return;
      }
    }

    /* 2) Id immagine trascinato dalla galleria (testo del dataTransfer). */
    var data = '';
    try { data = dt.getData('text/plain') || dt.getData('text') || ''; } catch (e2) { data = ''; }
    data = String(data).trim();
    if (data) {
      /* Accetta sia "img:ID" sia il solo ID. */
      var ref = /^img:/i.test(data) ? data : 'img:' + data;
      this._setSlideImage(index, ref);
    }
  };

  /* Imposta il riferimento immagine della slide `index` nel sorgente. */
  Editor.prototype._setSlideImage = function (index, ref) {
    if (!this.elSource || !OFG.blocks || !OFG.blocks.setImage) return;
    var md = OFG.blocks.setImage(this.elSource.value, index, ref);
    this.elSource.value = md;
    this._render();
    this._persist();
    this._showNotice('info', 'Foto assegnata alla slide ' + (index + 1) + '.');
  };

  /* --------------------------------------------------------
     RIORDINO SLIDE (striscia di miniature drag&drop)
     -------------------------------------------------------- */

  /* Ricostruisce la striscia: una voce trascinabile per slide
     (numero + tipo + titolo troncato). Drop -> OFG.blocks.reorder. */
  Editor.prototype._renderStrip = function () {
    var self = this;
    if (!this.elStrip) return;
    if (!OFG.blocks || !OFG.blocks.split || !OFG.blocks.reorder) {
      this.elStrip.innerHTML = '';
      return;
    }

    /* Svuota e ricostruisce. */
    this.elStrip.innerHTML = '';
    var slides = this.slides || [];

    for (var i = 0; i < slides.length; i++) {
      var s = slides[i] || {};
      var item = document.createElement('div');
      item.className = 'slide-strip__item';
      item.setAttribute('draggable', 'true');
      item.setAttribute('data-strip-index', String(i));

      var num = document.createElement('span');
      num.className = 'slide-strip__num';
      num.textContent = String(i + 1);

      var meta = document.createElement('span');
      meta.className = 'slide-strip__meta';

      var type = document.createElement('span');
      type.className = 'slide-strip__type';
      type.textContent = s.type || 'slide';

      var title = document.createElement('span');
      title.className = 'slide-strip__title';
      title.textContent = stripTitle(s);

      meta.appendChild(type);
      meta.appendChild(title);
      item.appendChild(num);
      item.appendChild(meta);
      this.elStrip.appendChild(item);
    }

    /* Aggancia i listener di drag una sola volta sul contenitore
       (delega): semplice e robusto. */
    if (!this._stripBound) {
      this._stripBound = true;
      var strip = this.elStrip;

      strip.addEventListener('dragstart', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('.slide-strip__item') : null;
        if (!item) return;
        self._dragFrom = parseInt(item.getAttribute('data-strip-index'), 10);
        item.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          /* Necessario per Firefox: serve un payload. */
          try { e.dataTransfer.setData('text/plain', String(self._dragFrom)); } catch (e2) {}
        }
      });

      strip.addEventListener('dragover', function (e) {
        if (self._dragFrom == null) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        var item = e.target && e.target.closest ? e.target.closest('.slide-strip__item') : null;
        /* Evidenzia la voce sotto il cursore. */
        var all = strip.querySelectorAll('.slide-strip__item');
        for (var k = 0; k < all.length; k++) all[k].classList.remove('is-drop-over');
        if (item) item.classList.add('is-drop-over');
      });

      strip.addEventListener('dragleave', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('.slide-strip__item') : null;
        if (item) item.classList.remove('is-drop-over');
      });

      strip.addEventListener('drop', function (e) {
        e.preventDefault();
        var item = e.target && e.target.closest ? e.target.closest('.slide-strip__item') : null;
        var from = self._dragFrom;
        self._dragFrom = null;
        /* Pulisci evidenziazioni. */
        var all = strip.querySelectorAll('.slide-strip__item');
        for (var k = 0; k < all.length; k++) {
          all[k].classList.remove('is-drop-over');
          all[k].classList.remove('is-dragging');
        }
        if (item == null || from == null || isNaN(from)) return;
        var to = parseInt(item.getAttribute('data-strip-index'), 10);
        if (isNaN(to) || to === from) return;
        if (!self.elSource) return;
        var md = OFG.blocks.reorder(self.elSource.value, from, to);
        self.elSource.value = md;
        self._render();
        self._persist();
      });

      strip.addEventListener('dragend', function () {
        self._dragFrom = null;
        var all = strip.querySelectorAll('.slide-strip__item');
        for (var k = 0; k < all.length; k++) {
          all[k].classList.remove('is-drop-over');
          all[k].classList.remove('is-dragging');
        }
      });
    }
  };

  /* Ricava un titolo breve per una slide nella striscia (testo senza tag). */
  function stripTitle(s) {
    var t = s && (s.title || s.text || '');
    if (!t) return '(senza titolo)';
    var tmp = document.createElement('div');
    tmp.innerHTML = String(t);
    var text = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '(senza titolo)';
    return text.length > 40 ? text.slice(0, 39) + '…' : text;
  }

  /* --------------------------------------------------------
     EXPORT
     -------------------------------------------------------- */

  Editor.prototype._export = function () {
    var self = this;
    var slides = this._applyThemeOverride(this.slides);

    if (!slides || slides.length === 0) {
      this._showNotice('info', 'Aggiungi almeno una slide prima di esportare.');
      return;
    }
    if (!OFG.downloadHTML) {
      this._showNotice('error', 'Modulo di export non disponibile.');
      return;
    }

    /* Disabilita temporaneamente il bottone per evitare doppi click. */
    if (this.elBtnExport) this.elBtnExport.disabled = true;

    /* Titolo: usa il titolo della prima slide (testo, senza tag). */
    var title = this._deriveTitle(slides);

    Promise.resolve(
      OFG.downloadHTML(slides, { mode: this.mode, title: title, filename: title })
    ).then(function () {
      self._showNotice('info', 'Presentazione esportata come file HTML autonomo.');
    }).catch(function (err) {
      self._showNotice('error',
        'Export non riuscito: ' + (err && err.message ? err.message : 'errore sconosciuto') + '.');
    }).then(function () {
      if (self.elBtnExport) self.elBtnExport.disabled = false;
    });
  };

  /* Ricava un titolo leggibile dalla prima slide (rimuove i tag HTML
     inline gia' presenti nel campo title). */
  Editor.prototype._deriveTitle = function (slides) {
    for (var i = 0; i < slides.length; i++) {
      var t = slides[i] && slides[i].title;
      if (t) {
        var tmp = document.createElement('div');
        tmp.innerHTML = t;
        var text = (tmp.textContent || '').trim();
        if (text) return text;
      }
    }
    return 'Presentazione OFG';
  };

  /* --------------------------------------------------------
     UI: conteggio, stato vuoto, notice, autosave
     -------------------------------------------------------- */

  Editor.prototype._updateCount = function (n) {
    if (!this.elCount) return;
    this.elCount.textContent = n + (n === 1 ? ' slide' : ' slide');
  };

  Editor.prototype._toggleEmpty = function (isEmpty) {
    if (this.elEmpty) this.elEmpty.hidden = !isEmpty;
  };

  /* Mostra un avviso gentile (info|error). Si auto-nasconde. */
  Editor.prototype._showNotice = function (kind, message) {
    if (!this.elNotice) return;
    this.elNotice.className = 'notice notice--' + (kind === 'error' ? 'error' : 'info') + ' is-visible';
    var prefix = kind === 'error' ? '<strong>Attenzione.</strong> ' : '';
    this.elNotice.innerHTML = prefix + escapeText(message);
    if (this._noticeTimer) clearTimeout(this._noticeTimer);
    /* Gli errori restano un po' di piu' degli info. */
    var ttl = kind === 'error' ? 6000 : 3200;
    var self = this;
    this._noticeTimer = setTimeout(function () { self._clearNotice(); }, ttl);
  };

  Editor.prototype._clearNotice = function () {
    if (!this.elNotice) return;
    this.elNotice.classList.remove('is-visible');
  };

  Editor.prototype._persist = function () {
    if (this.elSource) lsSet(STORAGE_KEY, this.elSource.value);
  };

  /* Escape testo semplice per i messaggi notice (non usiamo OFG.escapeHtml
     per non dipendere dall'ordine di caricamento). */
  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* --------------------------------------------------------
     ESPOSIZIONE + AUTO-INIT
     -------------------------------------------------------- */

  OFG.Editor = {
    init: function (opts) { return new Editor(opts); },
    Editor: Editor
  };

  /* Auto-avvio quando il DOM e' pronto, se in pagina c'e' la shell
     dell'editor (#source). Cosi' index.html deve solo includere lo
     script: nessun boilerplate aggiuntivo. */
  function autostart() {
    if (document.getElementById('source')) {
      try { new Editor(); } catch (e) { /* no-op */ }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autostart);
  } else {
    autostart();
  }

})(typeof window !== 'undefined' ? window : this);
