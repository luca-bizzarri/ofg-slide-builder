/*
 * ai-compose.js — OFG.aiCompose
 *
 * Ponte verso il backend di ofg-tool (micro-servizio FastAPI) per generare
 * il markdown OFG di una presentazione a partire da un brief e/o testo libero,
 * piazzando le foto disponibili. NESSUNA chiave qui: la chiamata va al backend
 * locale (default http://localhost:8800), che usa l'LLM gia' configurato di ofg-tool.
 *
 * API pubblica:
 *   OFG.aiCompose.getBackendUrl() / setBackendUrl(url)
 *   OFG.aiCompose.health() -> Promise<boolean>
 *   OFG.aiCompose.compose({brief, text, clientId, maxSlides}) -> Promise<{markdown, usedImageIds, model}>
 *   OFG.aiCompose.sanitize(md) -> { markdown, removedImages, slideCount }
 *
 * Vincolo: funziona solo se questa pagina e' servita in locale (http://localhost).
 * Su https (es. GitHub Pages) il browser blocca la chiamata a http://localhost.
 */
(function (global) {
  'use strict';

  var OFG = (global.OFG = global.OFG || {});

  var LS_KEY = 'ofg.ai.backend';
  var DEFAULT_URL = 'http://localhost:8800';

  function getBackendUrl() {
    try {
      var v = global.localStorage.getItem(LS_KEY);
      return (v && v.trim()) ? v.trim().replace(/\/+$/, '') : DEFAULT_URL;
    } catch (e) {
      return DEFAULT_URL;
    }
  }

  function setBackendUrl(url) {
    try {
      if (url && String(url).trim()) {
        global.localStorage.setItem(LS_KEY, String(url).trim().replace(/\/+$/, ''));
      }
    } catch (e) { /* no-op */ }
  }

  /* True se la pagina e' su https: in quel caso la chiamata a http://localhost
     sara' bloccata (mixed content). Serve a mostrare un messaggio chiaro. */
  function isBlockedByMixedContent() {
    try {
      return global.location && global.location.protocol === 'https:'
        && /^http:\/\//i.test(getBackendUrl());
    } catch (e) {
      return false;
    }
  }

  /* GET /health con timeout. Ritorna true se il backend risponde ok. */
  function health() {
    if (!global.fetch) return Promise.resolve(false);
    var ctrl = (typeof global.AbortController === 'function') ? new global.AbortController() : null;
    var timer = ctrl ? global.setTimeout(function () { ctrl.abort(); }, 2500) : 0;
    return global.fetch(getBackendUrl() + '/health', {
      method: 'GET',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      return !!(j && j.status === 'ok');
    }).catch(function () {
      return false;
    }).then(function (res) {
      if (timer) global.clearTimeout(timer);
      return res;
    });
  }

  /* Elenco {id,name} delle foto disponibili nello store (mai i dataUri). */
  function imageList() {
    if (!OFG.images || typeof OFG.images.all !== 'function') return [];
    return OFG.images.all().map(function (it) {
      return { id: String(it.id), name: it.name || '' };
    });
  }

  /* POST /compose. Risolve con {markdown, usedImageIds, model}. Rigetta con
     Error (messaggio leggibile) su rete/HTTP/payload non valido. */
  function compose(opts) {
    opts = opts || {};
    if (!global.fetch) return Promise.reject(new Error('fetch non disponibile in questo browser.'));
    if (isBlockedByMixedContent()) {
      return Promise.reject(new Error(
        'La pagina e\' su https: il browser blocca la chiamata al backend locale. ' +
        'Apri lo slide-builder da http://localhost:8000.'));
    }
    var body = {
      brief: opts.brief || '',
      text: opts.text || '',
      images: imageList(),
      client_id: opts.clientId || null,
      max_slides: opts.maxSlides || 12
    };
    return global.fetch(getBackendUrl() + '/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) {
          var msg = (j && (j.error || j.detail)) ? (j.error || j.detail) : ('HTTP ' + r.status);
          throw new Error(msg);
        }
        if (!j || typeof j.markdown !== 'string') {
          throw new Error((j && j.error) ? j.error : 'Risposta del backend non valida.');
        }
        return { markdown: j.markdown, usedImageIds: j.used_image_ids || [], model: j.model || '' };
      });
    }).catch(function (err) {
      if (err && err.name === 'TypeError') {
        // fetch fallito (rete/CORS/irraggiungibile)
        throw new Error('Backend AI non raggiungibile su ' + getBackendUrl() +
          '. Avvia ofg-tool (uvicorn api:app --port 8800).');
      }
      throw err;
    });
  }

  /* Toglie eventuali code-fence e righe di contorno prima del primo blocco. */
  function stripFences(md) {
    var s = String(md == null ? '' : md).trim();
    var m = s.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
    if (m) s = m[1].trim();
    var lines = s.split('\n');
    var start = 0;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t.indexOf('::') === 0 || t.indexOf('#') === 0 || /^-{3,}$/.test(t)) { start = i; break; }
    }
    return lines.slice(start).join('\n').trim();
  }

  /* Valida/ripulisce il markdown generato dall'AI:
     - normalizza i separatori di blocco;
     - rimuove le righe immagine con id NON presenti nello store (no token rotti);
     - verifica con OFG.parse che produca almeno una slide.
     Ritorna { markdown, removedImages, slideCount }. */
  function sanitize(md) {
    var out = stripFences(md);
    var removed = 0;

    var validIds = {};
    imageList().forEach(function (it) { validIds[it.id] = true; });

    if (OFG.blocks && OFG.blocks.split && OFG.blocks.getImage && OFG.blocks.setImage) {
      // normalizza i separatori
      out = OFG.blocks.join(OFG.blocks.split(out));
      var n = OFG.blocks.split(out).length;
      for (var i = 0; i < n; i++) {
        var img = OFG.blocks.getImage(out, i);
        if (img && img.ref) {
          var mm = String(img.ref).match(/^img:(.+)$/i);
          if (mm && !validIds[mm[1]]) {
            out = OFG.blocks.setImage(out, i, ''); // rimuove la riga immagine rotta
            removed++;
          }
        }
      }
    }

    var slideCount = 0;
    if (OFG.parse) {
      try { slideCount = OFG.parse(out).length; } catch (e) { slideCount = 0; }
    }
    return { markdown: out, removedImages: removed, slideCount: slideCount };
  }

  OFG.aiCompose = {
    getBackendUrl: getBackendUrl,
    setBackendUrl: setBackendUrl,
    isBlockedByMixedContent: isBlockedByMixedContent,
    health: health,
    imageList: imageList,
    compose: compose,
    sanitize: sanitize
  };

})(typeof window !== 'undefined' ? window : this);
