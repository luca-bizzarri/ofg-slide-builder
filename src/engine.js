/* ============================================================
   engine.js — Motore di navigazione delle presentazioni OFG
   --------------------------------------------------------------
   App 100% client-side, nessuna dipendenza. Espone l'API sul
   namespace globale window.OFG.

   Si occupa SOLO della navigazione: il container ricevuto deve
   gia' contenere le slide renderizzate da renderer.js, ciascuna
   con gli attributi di contratto (data-index, data-topic,
   data-theme, ecc.). L'engine non genera HTML di contenuto, ma:
     - costruisce la chrome di navigazione (dots, frecce,
       indicatore di posizione 2D);
     - gestisce tastiera, click, ruota, hash, resize;
     - applica le microanimazioni d'ingresso (reveal) e il tema
       dinamico via IntersectionObserver.

   API PUBBLICA (window.OFG):
     OFG.Engine(container, options) -> istanza
       options = { mode?: 'deck'|'landing', start?: number,
                   onChange?: (state) => void }
     Metodi d'istanza:
       engine.goTo(index)            // deck: indice; landing: indice globale
       engine.goTo(col, row)         // landing: colonna+riga espliciti
       engine.next()                 // slide successiva
       engine.prev()                 // slide precedente
       engine.setMode('deck'|'landing')
       engine.getState() -> { index, col, row, total, mode, theme }
       engine.destroy()
     Helper:
       OFG.init(container, slides, opts) -> istanza Engine
         (renderizza via OFG.renderDeck se disponibile, poi avvia
          l'engine; comodo per editor/export)

   CLASSI / ATTRIBUTI usati dal renderer (devono combaciare):
     - elementi da animare: classe ".reveal" + custom prop "--i"
       (stagger). L'engine aggiunge ".is-visible" quando la slide
       entra in vista (one-shot per slide; ri-armato al cambio
       slide attivo cosi' la transizione si rigioca).
     - barretta gialla ".bar" dentro un titolo: e' un ".reveal"
       come gli altri (riceve .is-visible).
     - ogni slide e' un <section class="slide ... theme-{theme}">
       con attr data-index, data-topic, data-theme, tabindex="-1".
     - tema: variabili --bg/--fg/--accent. In landing l'engine le
       riassegna sul container (cross-fade in --dur-theme).
   ============================================================ */

(function (global) {
  'use strict';

  /* Namespace condiviso (riusato se gia' esistente). */
  var OFG = (global.OFG = global.OFG || {});

  /* Modalita' ammesse. */
  var MODES = ['deck', 'landing'];

  /* Mappa tema -> variabili CSS, usata per il cross-fade del tema
     in modalita' landing (dove il tema "globale" del container
     segue la slide attiva). I valori restano dentro i 3 colori
     brand piu' i grigi tecnici neutri gia' definiti nei token. */
  var THEME_VARS = {
    light: { '--bg': 'var(--white)', '--fg': 'var(--ink)', '--accent': 'var(--yellow)' },
    dark:  { '--bg': 'var(--black)', '--fg': 'var(--white)', '--accent': 'var(--yellow)' }
  };

  /* -----------------------------------------------------------
     Utility minime
     ----------------------------------------------------------- */

  /* Limita n nell'intervallo [min, max]. */
  function clamp(n, min, max) {
    return n < min ? min : (n > max ? max : n);
  }

  /* matchMedia sicuro: ritorna false se l'ambiente non supporta. */
  function prefersReducedMotion() {
    try {
      return global.matchMedia &&
        global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  /* Crea un elemento con classe e attributi opzionali. */
  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    return node;
  }

  /* -----------------------------------------------------------
     Costruttore Engine
     ----------------------------------------------------------- */

  /**
   * @param {HTMLElement} container  contenitore con le slide gia' renderizzate
   * @param {Object} [options]
   * @param {'deck'|'landing'} [options.mode='deck']
   * @param {number} [options.start=0]
   * @param {function} [options.onChange]
   */
  function Engine(container, options) {
    if (!(this instanceof Engine)) {
      return new Engine(container, options);
    }
    if (!container) {
      throw new Error('OFG.Engine: container mancante');
    }

    options = options || {};

    this.container = container;
    this.mode = MODES.indexOf(options.mode) >= 0 ? options.mode : 'deck';
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;

    /* Slide DOM in ordine di documento (NodeList -> array statico). */
    this.slides = [];

    /* Indice globale della slide attiva (0-based). */
    this.index = 0;

    /* Stato landing: colonne (=topic) e mappa indice->(col,row). */
    this.columns = [];      // array di array di slide
    this.colOf = [];        // colOf[index] = colonna della slide
    this.rowOf = [];        // rowOf[index] = riga (posizione nel topic)
    this.col = 0;
    this.row = 0;

    /* Riferimenti alla chrome di navigazione. */
    this.dotsEl = null;
    this.arrowsEl = null;
    this.posEl = null;

    /* Observer e listener registrati (per destroy pulito). */
    this._revealObs = null;
    this._themeObs = null;
    this._listeners = [];     // [{ target, type, fn, opts }]
    this._scrollRaf = 0;
    this._reduced = prefersReducedMotion();
    this._destroyed = false;

    /* Avvio. */
    this._collectSlides();
    var start = clamp(options.start | 0, 0, Math.max(0, this.slides.length - 1));
    this.index = start;
    this._build();
    /* Posizionamento iniziale: prima prova l'hash di deep-link. */
    if (!this._applyHash()) {
      this._syncToIndex(start, true);
    }
  }

  /* -----------------------------------------------------------
     Raccolta delle slide e calcolo della griglia landing
     ----------------------------------------------------------- */

  Engine.prototype._collectSlides = function () {
    var nodes = this.container.querySelectorAll('.slide');
    this.slides = Array.prototype.slice.call(nodes);

    /* Ordina per data-index se presente, altrimenti ordine documento. */
    this.slides.sort(function (a, b) {
      var ia = parseInt(a.getAttribute('data-index'), 10);
      var ib = parseInt(b.getAttribute('data-index'), 10);
      if (isNaN(ia) || isNaN(ib)) return 0;
      return ia - ib;
    });

    this._computeColumns();
  };

  /* Raggruppa le slide per topic preservando l'ordine di prima
     comparsa del topic (= ordine delle colonne). Le slide senza
     topic ('') ricevono ciascuna una colonna propria, cosi' non
     vengono accorpate per sbaglio. */
  Engine.prototype._computeColumns = function () {
    var cols = [];
    var byTopic = {};        // topic non vuoto -> indice colonna
    this.colOf = [];
    this.rowOf = [];

    for (var i = 0; i < this.slides.length; i++) {
      var slide = this.slides[i];
      var topic = slide.getAttribute('data-topic') || '';
      var ci;
      if (topic === '') {
        ci = cols.length;
        cols.push([]);
      } else if (Object.prototype.hasOwnProperty.call(byTopic, topic)) {
        ci = byTopic[topic];
      } else {
        ci = cols.length;
        byTopic[topic] = ci;
        cols.push([]);
      }
      this.colOf[i] = ci;
      this.rowOf[i] = cols[ci].length;
      cols[ci].push(slide);
    }

    this.columns = cols;
  };

  /* -----------------------------------------------------------
     Costruzione: classi container, chrome, observer, listener
     ----------------------------------------------------------- */

  Engine.prototype._build = function () {
    var c = this.container;

    /* Classi di modalita' sul container. */
    c.classList.add('deck');
    c.classList.remove('deck--deck', 'deck--landing');
    c.classList.add('deck--' + this.mode);

    /* Indicizza i topic come custom prop per il CSS landing
       (numero di colonne -> larghezza riga 2D). */
    c.style.setProperty('--cols', String(this.columns.length || 1));

    this._buildChrome();
    this._buildObservers();
    this._bindEvents();
  };

  /* Crea dots, frecce e indicatore di posizione 2D. La chrome
     vive DENTRO il container (posizionata via CSS, z-index nav).
     Viene marcata con data-ofg-chrome per poterla rimuovere. */
  Engine.prototype._buildChrome = function () {
    this._destroyChrome();

    var self = this;
    var total = this.slides.length;

    /* --- Frecce prev/next (entrambe le modalita') --- */
    var arrows = el('div', 'nav-arrows', { 'data-ofg-chrome': '1' });
    var prev = el('button', 'nav-arrow nav-arrow--prev',
      { type: 'button', 'aria-label': 'Slide precedente' });
    prev.innerHTML = '‹'; // ‹
    var next = el('button', 'nav-arrow nav-arrow--next',
      { type: 'button', 'aria-label': 'Slide successiva' });
    next.innerHTML = '›'; // ›
    arrows.appendChild(prev);
    arrows.appendChild(next);
    this._on(prev, 'click', function () { self.prev(); });
    this._on(next, 'click', function () { self.next(); });
    this.container.appendChild(arrows);
    this.arrowsEl = arrows;

    if (this.mode === 'deck') {
      /* --- Dots di navigazione (uno per slide) --- */
      var dots = el('div', 'nav-dots', {
        'data-ofg-chrome': '1', role: 'tablist', 'aria-label': 'Navigazione slide'
      });
      this._dotEls = [];
      for (var i = 0; i < total; i++) {
        (function (i) {
          var dot = el('button', 'nav-dot', {
            type: 'button', role: 'tab',
            'aria-label': 'Vai alla slide ' + (i + 1)
          });
          self._on(dot, 'click', function () { self.goTo(i); });
          dots.appendChild(dot);
          self._dotEls.push(dot);
        })(i);
      }
      this.container.appendChild(dots);
      this.dotsEl = dots;
    } else {
      /* --- Indicatore posizione 2D (landing) --- */
      var pos = el('div', 'pos-indicator', {
        'data-ofg-chrome': '1', 'aria-hidden': 'true'
      });
      var colTrack = el('div', 'pos-indicator__cols');
      this._posColEls = [];
      for (var c2 = 0; c2 < this.columns.length; c2++) {
        var pc = el('span', 'pos-indicator__col');
        colTrack.appendChild(pc);
        this._posColEls.push(pc);
      }
      var label = el('span', 'pos-indicator__label');
      pos.appendChild(colTrack);
      pos.appendChild(label);
      this.container.appendChild(pos);
      this.posEl = pos;
      this._posLabel = label;
    }
  };

  /* -----------------------------------------------------------
     IntersectionObserver: reveal d'ingresso + tema dinamico
     ----------------------------------------------------------- */

  Engine.prototype._buildObservers = function () {
    var self = this;

    /* --- Reveal degli elementi .reveal (threshold ~0.15) --- */
    if (global.IntersectionObserver) {
      this._revealObs = new global.IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            /* one-shot: smettiamo di osservare questo elemento. */
            self._revealObs.unobserve(e.target);
          }
        }
      }, { root: null, threshold: 0.15 });

      var reveals = this.container.querySelectorAll('.reveal');
      for (var r = 0; r < reveals.length; r++) {
        if (this._reduced) {
          /* Reduced motion: tutto subito visibile, niente observer. */
          reveals[r].classList.add('is-visible');
        } else {
          this._revealObs.observe(reveals[r]);
        }
      }

      /* --- Tema dinamico per landing (threshold ~0.6) --- */
      if (this.mode === 'landing') {
        this._themeObs = new global.IntersectionObserver(function (entries) {
          /* Sceglie l'entry piu' visibile come "slide dominante". */
          var best = null;
          for (var j = 0; j < entries.length; j++) {
            if (!entries[j].isIntersecting) continue;
            if (!best || entries[j].intersectionRatio > best.intersectionRatio) {
              best = entries[j];
            }
          }
          if (best) self._applyTheme(best.target.getAttribute('data-theme'));
        }, { root: null, threshold: [0.6] });

        for (var s = 0; s < this.slides.length; s++) {
          this._themeObs.observe(this.slides[s]);
        }
      }
    } else {
      /* Nessun IntersectionObserver: rendi tutto visibile. */
      var all = this.container.querySelectorAll('.reveal');
      for (var a = 0; a < all.length; a++) all[a].classList.add('is-visible');
    }
  };

  /* Applica il tema al container (cross-fade via --bg/--fg/--accent).
     In deck non serve riassegnare globalmente: ogni slide porta gia'
     il proprio fondo; lo usiamo comunque per coerenza chrome. */
  Engine.prototype._applyTheme = function (theme) {
    if (THEMES_HAS(theme) === false) theme = 'light';
    if (this._currentTheme === theme) return;
    this._currentTheme = theme;
    var vars = THEME_VARS[theme];
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        this.container.style.setProperty(k, vars[k]);
      }
    }
    this.container.setAttribute('data-active-theme', theme);
  };

  /* Verifica che un tema sia valido usando OFG.THEMES se presente. */
  function THEMES_HAS(t) {
    var list = (OFG.THEMES && OFG.THEMES.length) ? OFG.THEMES : ['light', 'dark'];
    return list.indexOf(t) >= 0;
  }

  /* -----------------------------------------------------------
     Event binding (tastiera, ruota, scroll, hash, resize)
     ----------------------------------------------------------- */

  Engine.prototype._bindEvents = function () {
    var self = this;

    /* Tastiera: gestita a livello document cosi' funziona anche se
       il focus non e' su una slide. */
    this._on(document, 'keydown', function (ev) { self._onKey(ev); });

    /* Aggiornamento stato allo scroll (snap nativo muove il container):
       throttle via requestAnimationFrame. */
    this._on(this.container, 'scroll', function () {
      if (self._scrollRaf) return;
      self._scrollRaf = global.requestAnimationFrame(function () {
        self._scrollRaf = 0;
        self._onScroll();
      });
    }, { passive: true });

    /* Deep-link: reagisce ai cambi di hash. */
    this._on(global, 'hashchange', function () { self._applyHash(); });

    /* Resize: ricalcola la posizione (le slide cambiano dimensione). */
    this._on(global, 'resize', function () {
      if (self._scrollRaf) return;
      self._scrollRaf = global.requestAnimationFrame(function () {
        self._scrollRaf = 0;
        self._syncToIndex(self.index, false);
      });
    }, { passive: true });
  };

  /* Tastiera: frecce, PageUp/Down, Space, Home/End.
     In deck ←/→ navigano; in landing ←/→ cambiano topic e ↑/↓
     scorrono dentro il topic. */
  Engine.prototype._onKey = function (ev) {
    /* Ignora se l'utente sta scrivendo in un campo editor. */
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }

    var handled = true;
    switch (ev.key) {
      case 'ArrowRight':
        if (this.mode === 'landing') this._moveCol(1); else this.next();
        break;
      case 'ArrowLeft':
        if (this.mode === 'landing') this._moveCol(-1); else this.prev();
        break;
      case 'ArrowDown':
      case 'PageDown':
        if (this.mode === 'landing') this._moveRow(1); else this.next();
        break;
      case 'ArrowUp':
      case 'PageUp':
        if (this.mode === 'landing') this._moveRow(-1); else this.prev();
        break;
      case ' ':
      case 'Spacebar':
        if (ev.shiftKey) this.prev(); else this.next();
        break;
      case 'Home':
        this.goTo(0);
        break;
      case 'End':
        this.goTo(this.slides.length - 1);
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
  };

  /* Allo scroll, deduce la slide attiva piu' vicina al centro del
     viewport del container e aggiorna lo stato (senza ri-scrollare). */
  Engine.prototype._onScroll = function () {
    var rect = this.container.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var bestIdx = this.index;
    var bestDist = Infinity;

    for (var i = 0; i < this.slides.length; i++) {
      var sr = this.slides[i].getBoundingClientRect();
      var sx = sr.left + sr.width / 2;
      var sy = sr.top + sr.height / 2;
      var d = (sx - cx) * (sx - cx) + (sy - cy) * (sy - cy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    if (bestIdx !== this.index) {
      this.index = bestIdx;
      this.col = this.colOf[bestIdx] || 0;
      this.row = this.rowOf[bestIdx] || 0;
      this._rearmReveals(this.slides[bestIdx]);
      this._updateChrome();
      this._emitChange();
    }
  };

  /* -----------------------------------------------------------
     Navigazione: goTo / next / prev / move
     ----------------------------------------------------------- */

  /**
   * Vai a una slide.
   *  - deck:    goTo(index)
   *  - landing: goTo(globalIndex)  oppure  goTo(col, row)
   */
  Engine.prototype.goTo = function (a, b) {
    var idx;
    if (typeof b === 'number') {
      /* Forma (col, row) per landing. */
      var col = clamp(a | 0, 0, Math.max(0, this.columns.length - 1));
      var row = clamp(b | 0, 0, Math.max(0, this.columns[col].length - 1));
      idx = this._indexOf(col, row);
    } else {
      idx = clamp(a | 0, 0, Math.max(0, this.slides.length - 1));
    }
    if (isNaN(idx) || idx < 0) idx = 0;
    this._syncToIndex(idx, false);
  };

  Engine.prototype.next = function () {
    this.goTo(Math.min(this.index + 1, this.slides.length - 1));
  };

  Engine.prototype.prev = function () {
    this.goTo(Math.max(this.index - 1, 0));
  };

  /* Cambio topic in landing: resta sulla stessa riga se esiste,
     altrimenti sull'ultima riga disponibile della nuova colonna. */
  Engine.prototype._moveCol = function (delta) {
    var col = clamp(this.col + delta, 0, this.columns.length - 1);
    if (col === this.col) return;
    var row = clamp(this.row, 0, this.columns[col].length - 1);
    this.goTo(col, row);
  };

  /* Scorrimento dentro il topic (verticale) in landing. */
  Engine.prototype._moveRow = function (delta) {
    var row = clamp(this.row + delta, 0, this.columns[this.col].length - 1);
    if (row === this.row) return;
    this.goTo(this.col, row);
  };

  /* Trova l'indice globale data (col,row). */
  Engine.prototype._indexOf = function (col, row) {
    var slide = this.columns[col] && this.columns[col][row];
    if (!slide) return this.index;
    return this.slides.indexOf(slide);
  };

  /* -----------------------------------------------------------
     Sincronizzazione DOM <-> stato
     ----------------------------------------------------------- */

  /* Porta la vista alla slide idx. instant=true salta l'animazione
     di scroll (init/resize). Aggiorna stato, chrome, hash, tema. */
  Engine.prototype._syncToIndex = function (idx, instant) {
    if (this._destroyed) return;
    idx = clamp(idx | 0, 0, Math.max(0, this.slides.length - 1));
    var changed = idx !== this.index;
    this.index = idx;
    this.col = this.colOf[idx] || 0;
    this.row = this.rowOf[idx] || 0;

    var target = this.slides[idx];
    if (target) {
      var behavior = (instant || this._reduced) ? 'auto' : 'smooth';
      /* scrollIntoView rispetta lo scroll-snap su entrambi gli assi. */
      if (target.scrollIntoView) {
        try {
          target.scrollIntoView({ behavior: behavior, block: 'start', inline: 'start' });
        } catch (e) {
          target.scrollIntoView();
        }
      }
      /* Focus programmatico (slide tabindex="-1") per accessibilita',
         senza far scrollare ulteriormente la pagina. */
      if (target.focus) {
        try { target.focus({ preventScroll: true }); } catch (e2) { /* no-op */ }
      }
      this._rearmReveals(target);
      if (this.mode === 'deck') this._applyTheme(target.getAttribute('data-theme'));
    }

    this._updateHash(idx);
    this._updateChrome();
    if (changed || instant) this._emitChange();
  };

  /* Ri-arma i .reveal della slide entrante: se non sono ancora
     visibili li ri-osserva, cosi' la transizione d'ingresso si
     gioca quando la slide e' effettivamente in viewport. */
  Engine.prototype._rearmReveals = function (slide) {
    if (this._reduced || !this._revealObs) return;
    var reveals = slide.querySelectorAll('.reveal');
    for (var i = 0; i < reveals.length; i++) {
      if (!reveals[i].classList.contains('is-visible')) {
        this._revealObs.observe(reveals[i]);
      }
    }
  };

  /* Aggiorna lo stato visivo della chrome (dot attivo, indicatore 2D). */
  Engine.prototype._updateChrome = function () {
    if (this.mode === 'deck' && this._dotEls) {
      for (var i = 0; i < this._dotEls.length; i++) {
        var on = (i === this.index);
        this._dotEls[i].classList.toggle('is-active', on);
        if (on) this._dotEls[i].setAttribute('aria-selected', 'true');
        else this._dotEls[i].removeAttribute('aria-selected');
      }
    } else if (this.mode === 'landing') {
      if (this._posColEls) {
        for (var c = 0; c < this._posColEls.length; c++) {
          this._posColEls[c].classList.toggle('is-active', c === this.col);
        }
      }
      if (this._posLabel) {
        var rows = this.columns[this.col] ? this.columns[this.col].length : 1;
        this._posLabel.textContent =
          (this.col + 1) + '/' + this.columns.length +
          '  ·  ' + (this.row + 1) + '/' + rows;
      }
    }
    /* Disabilita le frecce ai bordi del deck. */
    if (this.arrowsEl) {
      var prev = this.arrowsEl.querySelector('.nav-arrow--prev');
      var next = this.arrowsEl.querySelector('.nav-arrow--next');
      if (prev) prev.disabled = (this.index <= 0);
      if (next) next.disabled = (this.index >= this.slides.length - 1);
    }
  };

  /* -----------------------------------------------------------
     Deep-link via location.hash (#slide-N)
     ----------------------------------------------------------- */

  /* Legge l'hash corrente e, se valido, naviga. Ritorna true se
     ha gestito un hash valido. */
  Engine.prototype._applyHash = function () {
    var h = global.location && global.location.hash;
    if (!h) return false;
    var m = /^#slide-(\d+)$/.exec(h);
    if (!m) return false;
    var idx = clamp(parseInt(m[1], 10) || 0, 0, this.slides.length - 1);
    /* Evita loop: aggiorna solo se diverso. */
    this._syncToIndex(idx, true);
    return true;
  };

  /* Scrive l'hash senza creare voci nella cronologia (replaceState). */
  Engine.prototype._updateHash = function (idx) {
    var hash = '#slide-' + idx;
    if (global.location && global.location.hash === hash) return;
    try {
      if (global.history && global.history.replaceState) {
        global.history.replaceState(null, '', hash);
      } else {
        global.location.hash = hash;
      }
    } catch (e) { /* file:// puo' bloccare replaceState: ignora */ }
  };

  /* -----------------------------------------------------------
     Cambio modalita'
     ----------------------------------------------------------- */

  Engine.prototype.setMode = function (mode) {
    if (MODES.indexOf(mode) < 0 || mode === this.mode) return;
    var keepIndex = this.index;

    /* Smonta osservatori, chrome e listener legati alla modalita'. */
    this._teardownObservers();
    this._destroyChrome();
    this.mode = mode;

    /* Ricostruisce per la nuova modalita'. */
    this._build();
    this._syncToIndex(keepIndex, true);
  };

  /* -----------------------------------------------------------
     Stato e callback
     ----------------------------------------------------------- */

  Engine.prototype.getState = function () {
    var slide = this.slides[this.index];
    return {
      index: this.index,
      col: this.col,
      row: this.row,
      total: this.slides.length,
      mode: this.mode,
      theme: slide ? (slide.getAttribute('data-theme') || 'light') : 'light'
    };
  };

  Engine.prototype._emitChange = function () {
    if (this.onChange) {
      try { this.onChange(this.getState()); } catch (e) { /* no-op */ }
    }
  };

  /* -----------------------------------------------------------
     Registrazione listener tracciati (per destroy pulito)
     ----------------------------------------------------------- */

  Engine.prototype._on = function (target, type, fn, opts) {
    target.addEventListener(type, fn, opts || false);
    this._listeners.push({ target: target, type: type, fn: fn, opts: opts || false });
  };

  Engine.prototype._teardownObservers = function () {
    if (this._revealObs) { this._revealObs.disconnect(); this._revealObs = null; }
    if (this._themeObs) { this._themeObs.disconnect(); this._themeObs = null; }
  };

  Engine.prototype._destroyChrome = function () {
    var chrome = this.container.querySelectorAll('[data-ofg-chrome]');
    for (var i = 0; i < chrome.length; i++) {
      if (chrome[i].parentNode) chrome[i].parentNode.removeChild(chrome[i]);
    }
    this.dotsEl = this.arrowsEl = this.posEl = null;
    this._dotEls = this._posColEls = null;
    this._posLabel = null;
  };

  /* Rimuove TUTTO: listener, observer, chrome. Lascia le slide in
     pagina (le rimuove/ridisegna il renderer su nuovo parse). */
  Engine.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;

    /* Rimuove i listener tracciati. */
    for (var i = 0; i < this._listeners.length; i++) {
      var L = this._listeners[i];
      try { L.target.removeEventListener(L.type, L.fn, L.opts); } catch (e) { /* no-op */ }
    }
    this._listeners = [];

    if (this._scrollRaf && global.cancelAnimationFrame) {
      global.cancelAnimationFrame(this._scrollRaf);
      this._scrollRaf = 0;
    }

    this._teardownObservers();
    this._destroyChrome();

    /* Ripulisce le classi di modalita' dal container. */
    this.container.classList.remove('deck--deck', 'deck--landing');
  };

  /* -----------------------------------------------------------
     Helper di alto livello: render + engine in un colpo solo
     ----------------------------------------------------------- */

  /**
   * Comodita' per editor/export: se renderer.js e' presente,
   * renderizza i modelli nel container e avvia l'engine.
   * @param {HTMLElement} container
   * @param {Slide[]} slides
   * @param {Object} [opts]  passato sia a renderDeck sia a Engine
   * @returns {Engine}
   */
  function init(container, slides, opts) {
    opts = opts || {};
    if (OFG.renderDeck && Array.isArray(slides)) {
      OFG.renderDeck(container, slides, { mode: opts.mode || 'deck' });
    }
    return new Engine(container, opts);
  }

  /* -----------------------------------------------------------
     Esposizione pubblica
     ----------------------------------------------------------- */
  OFG.Engine = Engine;
  OFG.init = init;
  OFG.MODES = MODES;

})(typeof window !== 'undefined' ? window : this);
