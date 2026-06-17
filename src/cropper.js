/* ============================================================
   cropper.js — Widget di ritaglio/posizionamento foto OFG
   Overlay modale NON distruttivo: non taglia i pixel, produce
   solo parametri ({fit, posX, posY, zoom}) che l'app applichera'
   via CSS (object-fit / object-position / transform:scale) sul
   <img> di copertina reale.
   Vanilla JS, nessuna dipendenza esterna.
   ============================================================ */
(function () {
  'use strict';

  window.OFG = window.OFG || {};

  /* Valori di default dello stato del crop */
  var DEFAULTS = { fit: 'cover', posX: 50, posY: 50, zoom: 1 };
  var ZOOM_MIN = 1;
  var ZOOM_MAX = 3;

  /* Limita un numero tra min e max */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* Normalizza/valida le opzioni iniziali rispetto ai default */
  function normalizeOpts(opts) {
    opts = opts || {};
    return {
      fit: opts.fit === 'contain' ? 'contain' : 'cover',
      posX: clamp(typeof opts.posX === 'number' ? opts.posX : DEFAULTS.posX, 0, 100),
      posY: clamp(typeof opts.posY === 'number' ? opts.posY : DEFAULTS.posY, 0, 100),
      zoom: clamp(typeof opts.zoom === 'number' ? opts.zoom : DEFAULTS.zoom, ZOOM_MIN, ZOOM_MAX)
    };
  }

  /* Piccolo helper per creare elementi con attributi e classi */
  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  /**
   * Apre l'overlay del cropper.
   * @param {Object} options
   *   options.src      {string}   data URI o url dell'immagine
   *   options.opts     {Object}   stato iniziale {fit, posX, posY, zoom}
   *   options.onApply  {Function} chiamata con {fit, posX, posY, zoom} alla conferma
   *   options.onCancel {Function} opzionale, chiamata all'annullamento
   */
  function open(options) {
    options = options || {};
    var src = options.src || '';
    var onApply = typeof options.onApply === 'function' ? options.onApply : function () {};
    var onCancel = typeof options.onCancel === 'function' ? options.onCancel : function () {};

    /* Stato corrente (copia di lavoro) */
    var state = normalizeOpts(options.opts);

    /* Elemento attivo prima dell'apertura, per ripristinare il focus */
    var previouslyFocused = document.activeElement;

    /* ---------- Costruzione DOM ---------- */
    var overlay = el('div', 'cropper__overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ritaglia e posiziona la foto' });

    var card = el('div', 'cropper__card');

    var title = el('h2', 'cropper__title');
    title.textContent = 'Posiziona la foto';

    /* --- Anteprima 16:9 --- */
    var stage = el('div', 'cropper__stage', { 'aria-label': 'Anteprima ritaglio. Trascina per spostare il punto focale.', tabindex: '0' });
    var img = el('img', 'cropper__img', { alt: '', draggable: 'false' });
    img.src = src;
    var focal = el('div', 'cropper__focal', { 'aria-hidden': 'true' });
    stage.appendChild(img);
    stage.appendChild(focal);

    /* --- Controlli --- */
    var controls = el('div', 'cropper__controls');

    /* Toggle FIT */
    var fitRow = el('div', 'cropper__row');
    var fitLabel = el('span', 'cropper__label');
    fitLabel.textContent = 'Adattamento';
    var fitGroup = el('div', 'cropper__toggle', { role: 'group', 'aria-label': 'Modalita di adattamento' });
    var btnCover = el('button', 'cropper__toggle-btn', { type: 'button', 'aria-pressed': 'false' });
    btnCover.textContent = 'Riempi (cover)';
    var btnContain = el('button', 'cropper__toggle-btn', { type: 'button', 'aria-pressed': 'false' });
    btnContain.textContent = 'Contieni (contain)';
    fitGroup.appendChild(btnCover);
    fitGroup.appendChild(btnContain);
    fitRow.appendChild(fitLabel);
    fitRow.appendChild(fitGroup);

    /* Slider ZOOM */
    var zoomRow = el('div', 'cropper__row');
    var zoomLabel = el('label', 'cropper__label', { for: 'cropper-zoom' });
    zoomLabel.textContent = 'Zoom';
    var zoomInput = el('input', 'cropper__slider', {
      id: 'cropper-zoom',
      type: 'range',
      min: String(ZOOM_MIN),
      max: String(ZOOM_MAX),
      step: '0.01',
      'aria-label': 'Livello di zoom'
    });
    zoomInput.value = String(state.zoom);
    var zoomValue = el('span', 'cropper__value');
    zoomRow.appendChild(zoomLabel);
    zoomRow.appendChild(zoomInput);
    zoomRow.appendChild(zoomValue);

    /* Bottoni azione */
    var actions = el('div', 'cropper__actions');
    var btnCancel = el('button', 'cropper__btn cropper__btn--ghost', { type: 'button' });
    btnCancel.textContent = 'Annulla';
    var btnApply = el('button', 'cropper__btn cropper__btn--primary', { type: 'button' });
    btnApply.textContent = 'Applica';
    actions.appendChild(btnCancel);
    actions.appendChild(btnApply);

    controls.appendChild(fitRow);
    controls.appendChild(zoomRow);

    card.appendChild(title);
    card.appendChild(stage);
    card.appendChild(controls);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    /* ---------- Render live ---------- */

    /* Applica lo stato corrente all'anteprima e ai controlli */
    function render() {
      img.style.objectFit = state.fit;
      img.style.objectPosition = state.posX + '% ' + state.posY + '%';
      img.style.transform = 'scale(' + state.zoom + ')';

      focal.style.left = state.posX + '%';
      focal.style.top = state.posY + '%';

      zoomValue.textContent = state.zoom.toFixed(2) + '×';

      var isCover = state.fit === 'cover';
      btnCover.classList.toggle('is-active', isCover);
      btnContain.classList.toggle('is-active', !isCover);
      btnCover.setAttribute('aria-pressed', String(isCover));
      btnContain.setAttribute('aria-pressed', String(!isCover));
    }

    /* ---------- Drag punto focale (pointer events) ---------- */
    var dragging = false;

    /* Converte le coordinate del puntatore in posX/posY 0-100 */
    function updateFocalFromEvent(ev) {
      var rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var x = (ev.clientX - rect.left) / rect.width * 100;
      var y = (ev.clientY - rect.top) / rect.height * 100;
      state.posX = clamp(Math.round(x), 0, 100);
      state.posY = clamp(Math.round(y), 0, 100);
      render();
    }

    function onPointerDown(ev) {
      dragging = true;
      stage.classList.add('is-dragging');
      /* Cattura il puntatore cosi' il drag continua fuori dallo stage */
      if (stage.setPointerCapture && ev.pointerId !== undefined) {
        try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      updateFocalFromEvent(ev);
      ev.preventDefault();
    }

    function onPointerMove(ev) {
      if (!dragging) return;
      updateFocalFromEvent(ev);
      ev.preventDefault();
    }

    function onPointerUp(ev) {
      if (!dragging) return;
      dragging = false;
      stage.classList.remove('is-dragging');
      if (stage.releasePointerCapture && ev.pointerId !== undefined) {
        try { stage.releasePointerCapture(ev.pointerId); } catch (e) {}
      }
    }

    /* Tasti freccia sullo stage spostano il punto focale (accessibilita') */
    function onStageKey(ev) {
      var step = ev.shiftKey ? 10 : 2;
      var handled = true;
      switch (ev.key) {
        case 'ArrowLeft':  state.posX = clamp(state.posX - step, 0, 100); break;
        case 'ArrowRight': state.posX = clamp(state.posX + step, 0, 100); break;
        case 'ArrowUp':    state.posY = clamp(state.posY - step, 0, 100); break;
        case 'ArrowDown':  state.posY = clamp(state.posY + step, 0, 100); break;
        default: handled = false;
      }
      if (handled) {
        ev.preventDefault();
        render();
      }
    }

    /* ---------- Handler controlli ---------- */
    function onZoomInput() {
      state.zoom = clamp(parseFloat(zoomInput.value) || ZOOM_MIN, ZOOM_MIN, ZOOM_MAX);
      render();
    }

    function setFit(fit) {
      state.fit = fit === 'contain' ? 'contain' : 'cover';
      render();
    }

    /* ---------- Chiusura ---------- */
    var closed = false;

    function teardown() {
      if (closed) return;
      closed = true;
      /* Rimuovi tutti i listener */
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
      stage.removeEventListener('keydown', onStageKey);
      zoomInput.removeEventListener('input', onZoomInput);
      btnCover.removeEventListener('click', onCover);
      btnContain.removeEventListener('click', onContain);
      btnApply.removeEventListener('click', onApplyClick);
      btnCancel.removeEventListener('click', onCancelClick);
      overlay.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onDocKey, true);
      overlay.removeEventListener('keydown', onTrapKey);
      /* Rimuovi l'overlay dal DOM */
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      /* Ripristina il focus precedente */
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    }

    function confirm() {
      var result = {
        fit: state.fit,
        posX: state.posX,
        posY: state.posY,
        zoom: state.zoom
      };
      teardown();
      onApply(result);
    }

    function cancel() {
      teardown();
      onCancel();
    }

    function onCover() { setFit('cover'); }
    function onContain() { setFit('contain'); }
    function onApplyClick() { confirm(); }
    function onCancelClick() { cancel(); }

    /* Click sullo sfondo (non sulla card) -> annulla */
    function onBackdrop(ev) {
      if (ev.target === overlay) cancel();
    }

    /* Esc chiude annullando (capture per intercettare prima di altri) */
    function onDocKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancel();
      }
    }

    /* Focus trap minimale: Tab cicla solo dentro la card */
    function getFocusable() {
      return Array.prototype.slice.call(
        card.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')
      ).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    }

    function onTrapKey(ev) {
      if (ev.key !== 'Tab') return;
      var focusable = getFocusable();
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }

    /* ---------- Aggancio listener ---------- */
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('keydown', onStageKey);
    zoomInput.addEventListener('input', onZoomInput);
    btnCover.addEventListener('click', onCover);
    btnContain.addEventListener('click', onContain);
    btnApply.addEventListener('click', onApplyClick);
    btnCancel.addEventListener('click', onCancelClick);
    overlay.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onDocKey, true);
    overlay.addEventListener('keydown', onTrapKey);

    /* Primo render + focus iniziale sul pulsante Applica */
    render();
    /* requestAnimationFrame per assicurare il focus dopo il paint */
    requestAnimationFrame(function () {
      btnApply.focus();
    });
  }

  OFG.Cropper = { open: open };
})();
