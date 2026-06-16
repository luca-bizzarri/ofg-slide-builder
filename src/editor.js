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
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) self._loadFile(file);
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
