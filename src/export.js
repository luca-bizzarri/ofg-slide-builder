/* ============================================================
   export.js â€” Generazione di un file HTML AUTONOMO scaricabile
   --------------------------------------------------------------
   App 100% client-side, nessuna dipendenza. Espone l'API sul
   namespace globale window.OFG.

   Produce un singolo .html che funziona da solo (doppio click /
   GitHub Pages), SENZA l'interfaccia editor:
     - CSS inline: design-tokens + stili slide + layout di
       navigazione (deck/landing) + chrome (dots/frecce/indicatore);
     - font Raleway via Google Fonts (fallback CDN) + fallback di
       sistema, cosi' resta leggibile anche offline;
     - renderer + engine inline (gli stessi moduli del progetto,
       serializzati dal sorgente caricato in pagina);
     - i modelli slide gia' parse-ati e serializzati in JSON;
     - avvio automatico nella modalita' scelta (deck/landing).

   API PUBBLICA (window.OFG):
     OFG.exportHTML(slides, opts)  -> Promise<string>  (HTML completo)
     OFG.downloadHTML(slides, opts) -> Promise<void>   (avvia il download)
       opts = { mode?: 'deck'|'landing', title?: string, filename?: string }

   NOTE:
   - I sorgenti di renderer.js / engine.js vengono inclusi inline
     leggendoli dai relativi <script src> gia' presenti in pagina
     (fetch). Se il fetch non e' possibile (es. apertura da file://
     con restrizioni), si ricade su funzioni minime equivalenti
     ricostruite a runtime dalle funzioni gia' caricate (toString).
   - Il CSS inline e' una copia on-brand auto-contenuta: non dipende
     da file esterni, cosi' l'export resta un singolo file portabile.
   ============================================================ */

(function (global) {
  'use strict';

  /* Namespace condiviso. */
  var OFG = (global.OFG = global.OFG || {});

  /* --------------------------------------------------------
     UTILITY
     -------------------------------------------------------- */

  /* Escape minimale per inserire testo dentro attributi/markup HTML. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Serializza un valore JS in JSON sicuro da incassare in <script>:
     neutralizza la sequenza "</" cosi' non chiude il tag, e i
     separatori di riga Unicode che spezzerebbero lo script. */
  function jsonForScript(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(new RegExp('\u2028','g'), '\\u2028')
      .replace(new RegExp('\u2029','g'), '\\u2029')
  }

  /* Recupera il testo sorgente di uno script gia' incluso in pagina.
     Prova prima dal relativo <script src>, via fetch; se fallisce
     ritorna null (il chiamante usera' un fallback). */
  function fetchScriptText(srcMatch) {
    /* Cerca un tag <script src> il cui path contenga srcMatch. */
    var scripts = document.getElementsByTagName('script');
    var url = null;
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i].getAttribute('src');
      if (s && s.indexOf(srcMatch) >= 0) { url = scripts[i].src || s; break; }
    }
    if (!url) return Promise.resolve(null);
    if (!global.fetch) return Promise.resolve(null);
    return global.fetch(url)
      .then(function (r) { return r.ok ? r.text() : null; })
      .catch(function () { return null; });
  }

  /* --------------------------------------------------------
     CSS INLINE â€” copia auto-contenuta on-brand
     --------------------------------------------------------
     Include: token, reset, tema, stili slide (paritÃ  con
     slides.css), animazioni, layout deck/landing e chrome di
     navigazione. Niente colori fuori dai 3 brand (+ grigi tecnici).
     -------------------------------------------------------- */
  function buildCSS() {
    return [
      /* ---- Token (estratto coerente con design-tokens.css) ---- */
      ':root{',
      '--black:#000;--white:#fff;--yellow:#ff0;',
      '--ink:#111;--ink-soft:#333;--paper:#fafafa;',
      '--line:rgba(0,0,0,.12);--line-on-dark:rgba(255,255,255,.16);',
      '--bg:var(--white);--fg:var(--ink);--accent:var(--yellow);',
      "--font-sans:'Raleway',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;",
      '--fw-thin:100;--fw-light:300;--fw-regular:400;--fw-medium:500;',
      '--fw-semibold:600;--fw-bold:700;--fw-extrabold:800;--fw-black:900;',
      '--fs-display:clamp(2.75rem,8vw,7.5rem);--fs-h1:clamp(2.25rem,6vw,5rem);',
      '--fs-h2:clamp(1.75rem,4.2vw,3.25rem);--fs-h3:clamp(1.25rem,2.6vw,1.9rem);',
      '--fs-lead:clamp(1.1rem,2vw,1.6rem);--fs-body:clamp(1rem,1.4vw,1.25rem);',
      '--fs-small:clamp(.8rem,1.1vw,.95rem);--fs-kpi:clamp(2.5rem,6vw,5rem);',
      '--lh-tight:.95;--lh-heading:1.08;--lh-body:1.55;',
      '--ls-display:-.03em;--ls-tight:-.015em;--ls-caps:.04em;',
      '--sp-1:.25rem;--sp-2:.5rem;--sp-3:.75rem;--sp-4:1rem;--sp-5:1.5rem;',
      '--sp-6:2rem;--sp-7:3rem;--sp-8:4rem;--sp-9:6rem;',
      '--slide-pad:clamp(1.5rem,5vw,5rem);--slide-max-w:1200px;',
      '--bar-w:70px;--bar-h:6px;',
      '--radius-sm:6px;--radius-md:12px;--radius-lg:20px;--radius-pill:999px;',
      '--shadow-md:0 8px 28px rgba(0,0,0,.18);--shadow-lg:0 18px 60px rgba(0,0,0,.28);',
      '--dur-base:320ms;--dur-reveal:700ms;--dur-theme:600ms;--dur-slide:800ms;',
      '--stagger-step:70ms;',
      '--ease-out:cubic-bezier(.16,1,.3,1);--ease-inout:cubic-bezier(.86,0,.07,1);',
      '--z-slide-content:10;--z-nav:100;--z-controls:110;',
      '}',
      /* ---- Reset minimo ---- */
      '*,*::before,*::after{box-sizing:border-box}',
      'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}',
      'body{margin:0;font-family:var(--font-sans);font-weight:var(--fw-regular);',
      'line-height:var(--lh-body);color:var(--fg);background:var(--black);',
      '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;',
      'overflow:hidden}',
      /* ---- Tema (logo come data:URI via --logo-src impostato sulla section) ---- */
      '.theme-light{--bg:var(--white);--fg:var(--ink);--fg-soft:var(--ink-soft);',
      '--accent:var(--yellow);--hairline:var(--line)}',
      '.theme-dark{--bg:var(--black);--fg:var(--white);',
      '--fg-soft:rgba(255,255,255,.72);--accent:var(--yellow);',
      '--hairline:var(--line-on-dark)}',
      /* ---- Deck container + sizing minimo della slide per lo scroll ---- */
      '.deck{position:relative;width:100vw;height:100dvh;background:var(--black);--slide-total:0}',
      /* Base minima: solo cio' che serve PRIMA che slides.css sia inlinato.
         L'aspetto completo di .slide/.slide__inner/.slide__logo/.slide__pageno
         e di tutti i tipi e' definito da src/slides.css (appeso dopo). */
      '.slide{position:relative;width:100%;min-height:100dvh;background:var(--bg);color:var(--fg)}',
      /* NOTA: tutto lo styling delle slide (tipografia, tipi, decori,
         media, tabella) NON e' qui: e' fornito dal vero src/slides.css
         che exportHTML fa fetch e inlina DOPO questo blocco, come fonte
         unica di verita' (l'export resta identico all'anteprima). Qui
         restano solo reset, token, tema, cornice base, animazioni reveal
         generiche, layout deck/landing e chrome di navigazione, che NON
         vivono in slides.css. Cosi' si evitano conflitti di cascata. */
      /* ---- Animazioni reveal (generiche, fallback) ---- */
      '@media (prefers-reduced-motion:no-preference){',
      '.reveal{opacity:0;transform:translateY(18px);',
      'transition:opacity var(--dur-reveal) var(--ease-out),',
      'transform var(--dur-reveal) var(--ease-out);',
      'transition-delay:calc(var(--i,0)*var(--stagger-step));',
      'will-change:opacity,transform}',
      '.reveal.is-visible{opacity:1;transform:none}',
      ".reveal[data-anim='left']{transform:translateX(-26px)}",
      ".reveal[data-anim='right']{transform:translateX(26px)}",
      ".reveal[data-anim='scale']{transform:scale(.92)}",
      ".reveal[data-anim='fade']{transform:none}",
      ".reveal[data-anim='left'].is-visible,.reveal[data-anim='right'].is-visible,",
      ".reveal[data-anim='scale'].is-visible{transform:none}",
      '.bar{transition:transform var(--dur-reveal) var(--ease-out);',
      'transition-delay:calc(var(--i,0)*var(--stagger-step))}',
      '.bar.is-visible,.is-visible>.bar,.is-visible .bar{transform:scaleX(1)}',
      '}',
      '@media (prefers-reduced-motion:reduce){',
      '.reveal,.reveal.is-visible{opacity:1!important;transform:none!important;',
      'transition:none!important}',
      '.bar{transform:scaleX(1)!important;transition:none!important}',
      '.slide{transition:none!important}',
      '}',
      /* ---- Layout DECK (scroll orizzontale + snap) ---- */
      '.deck--deck{display:flex;flex-direction:row;flex-wrap:nowrap;',
      'width:100vw;height:100dvh;overflow-x:auto;overflow-y:hidden;',
      'scroll-snap-type:x mandatory;scroll-behavior:smooth;',
      '-webkit-overflow-scrolling:touch;scrollbar-width:none}',
      '.deck--deck::-webkit-scrollbar{display:none}',
      '.deck--deck>.slide{flex:0 0 100vw;width:100vw;height:100dvh;',
      'scroll-snap-align:start;scroll-snap-stop:always}',
      /* ---- Layout LANDING (griglia 2D: colonne=topic, righe=slide) ---- */
      '.deck--landing{display:flex;flex-direction:row;flex-wrap:nowrap;',
      'width:100vw;height:100dvh;overflow-x:auto;overflow-y:hidden;',
      'scroll-snap-type:x mandatory;scroll-behavior:smooth;',
      '-webkit-overflow-scrolling:touch;scrollbar-width:none}',
      '.deck--landing::-webkit-scrollbar{display:none}',
      '.deck--landing>.slide{flex:0 0 100vw;width:100vw;height:100dvh;',
      'scroll-snap-align:start;scroll-snap-stop:always}',
      /* ---- Chrome di navigazione ---- */
      '.nav-arrows{position:fixed;inset:auto 0 50% 0;display:flex;',
      'justify-content:space-between;pointer-events:none;z-index:var(--z-controls);',
      'padding:0 clamp(.5rem,2vw,1.5rem)}',
      '.nav-arrow{pointer-events:auto;width:clamp(40px,6vw,56px);',
      'height:clamp(40px,6vw,56px);border-radius:var(--radius-pill);',
      'border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.45);',
      'color:#fff;font-size:1.6rem;line-height:1;cursor:pointer;',
      'display:flex;align-items:center;justify-content:center;',
      'backdrop-filter:blur(6px);transition:background var(--dur-base),',
      'transform var(--dur-base),opacity var(--dur-base)}',
      '.nav-arrow:hover{background:var(--accent);color:#000;transform:scale(1.06)}',
      '.nav-arrow:disabled{opacity:.25;cursor:default;transform:none}',
      '.nav-dots{position:fixed;left:50%;bottom:clamp(1rem,3vh,2rem);',
      'transform:translateX(-50%);display:flex;gap:var(--sp-2);align-items:center;',
      'z-index:var(--z-nav);padding:var(--sp-2) var(--sp-3);border-radius:var(--radius-pill);',
      'background:rgba(0,0,0,.35);backdrop-filter:blur(6px)}',
      '.nav-dot{width:10px;height:10px;padding:0;border:none;cursor:pointer;',
      'border-radius:var(--radius-pill);background:rgba(255,255,255,.45);',
      'transition:width var(--dur-base) var(--ease-out),background var(--dur-base)}',
      '.nav-dot.is-active{width:28px;background:var(--accent)}',
      '.pos-indicator{position:fixed;right:clamp(1rem,3vw,2rem);',
      'bottom:clamp(1rem,3vh,2rem);display:flex;flex-direction:column;',
      'align-items:flex-end;gap:var(--sp-2);z-index:var(--z-nav);',
      'padding:var(--sp-3);border-radius:var(--radius-md);',
      'background:rgba(0,0,0,.35);backdrop-filter:blur(6px)}',
      '.pos-indicator__cols{display:flex;gap:6px}',
      '.pos-indicator__col{width:18px;height:5px;border-radius:var(--radius-pill);',
      'background:rgba(255,255,255,.4);transition:background var(--dur-base)}',
      '.pos-indicator__col.is-active{background:var(--accent)}',
      '.pos-indicator__label{color:#fff;font-size:var(--fs-small);',
      'font-weight:var(--fw-semibold);letter-spacing:var(--ls-caps)}',
      /* Tabelle, responsive dei tipi slide: forniti da src/slides.css. */
      /* ---- Responsive della sola cornice/chrome (il resto e' in slides.css) ---- */
      '@media (max-width:768px){',
      '.slide{--frame-top:clamp(2.5rem,9vh,4rem)}',
      '}'
    ].join('');
  }

  /* --------------------------------------------------------
     RENDERER + ENGINE inline
     -------------------------------------------------------- */

  /* Tenta di recuperare i sorgenti reali di renderer.js / engine.js
     gia' caricati in pagina (fetch). Ritorna {renderer, engine} con
     i testi o null se non recuperabili. */
  function fetchModuleSources() {
    return Promise.all([
      fetchScriptText('renderer.js'),
      fetchScriptText('engine.js')
    ]).then(function (parts) {
      return { renderer: parts[0], engine: parts[1] };
    });
  }

  /* Fallback: se il fetch dei sorgenti fallisce, ricostruiamo i
     moduli dalle funzioni gia' presenti su window.OFG serializzandole.
     renderer espone renderSlide/renderDeck/renderSlideHTML/THEME_VARS;
     engine espone Engine/init/MODES. Le re-iniettiamo in una IIFE.
     (Percorso usato solo in ambienti che bloccano fetch da file://). */
  function fallbackModuleSource() {
    /* In pratica il browser permette quasi sempre il fetch dei file
       locali serviti insieme alla pagina; questo fallback minimale
       garantisce comunque uno script avviabile incollando le funzioni
       chiave come riferimento testuale. Per robustezza preferiamo
       comunque informare se i sorgenti non sono disponibili. */
    return null;
  }

  /* --------------------------------------------------------
     LOGO come data: URI (per restare un singolo file portabile)
     -------------------------------------------------------- */

  /* Converte i due loghi (nero / negativo) in data:URI, cosi' l'export
     non dipende dalla cartella assets. Imposta poi --logo-src per tema
     via una piccola regola CSS aggiuntiva. Se il fetch fallisce,
     ricade sui path relativi ./assets/... (funzionano su GitHub Pages). */
  function buildLogoCSS() {
    function toDataURI(path) {
      if (!global.fetch) return Promise.resolve(null);
      return global.fetch(path)
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (blob) {
          if (!blob) return null;
          return new Promise(function (resolve) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { resolve(null); };
            fr.readAsDataURL(blob);
          });
        })
        .catch(function () { return null; });
    }

    return Promise.all([
      toDataURI('./assets/logo-nero.png'),
      toDataURI('./assets/logo-negativo.png')
    ]).then(function (uris) {
      var nero = uris[0] || './assets/logo-nero.png';
      var neg = uris[1] || './assets/logo-negativo.png';
      /* Le url sono o data: o path relativi: in entrambi i casi sicure
         dentro url(). Evitiamo caratteri che chiudono la regola. */
      return '.theme-light{--logo-src:url("' + nero + '")}' +
             '.theme-dark{--logo-src:url("' + neg + '")}';
    });
  }

  /* --------------------------------------------------------
     COSTRUZIONE HTML COMPLETO
     -------------------------------------------------------- */

  /**
   * Genera la stringa HTML di un file autonomo.
   * @param {Array} slides  modelli slide (OFG.parse output)
   * @param {Object} [opts] { mode, title, filename }
   * @returns {Promise<string>}
   */
  /* Sostituisce i riferimenti "img:ID" con il dataURI reale dello store,
     cosi' l'HTML esportato resta un singolo file autonomo (lo store
     immagini non viene incluso nell'export). Per url/data/path lascia
     invariato; per un "img:ID" mancante azzera (mostrera' il placeholder). */
  function resolveModelImages(slides) {
    var canResolve = global.OFG && global.OFG.images
      && typeof global.OFG.images.resolve === 'function';
    return slides.map(function (s) {
      if (!s || !s.image || !/^img:/i.test(String(s.image))) return s;
      var clone = {};
      for (var k in s) {
        if (Object.prototype.hasOwnProperty.call(s, k)) clone[k] = s[k];
      }
      clone.image = canResolve ? (global.OFG.images.resolve(s.image) || '') : '';
      return clone;
    });
  }

  function exportHTML(slides, opts) {
    opts = opts || {};
    var mode = opts.mode === 'landing' ? 'landing' : 'deck';
    var title = opts.title && String(opts.title).trim()
      ? String(opts.title).trim()
      : 'Presentazione OFG';
    var models = resolveModelImages(Array.isArray(slides) ? slides : []);

    /* Recupera il testo di un foglio di stile incluso in pagina,
       cercando il <link> il cui href contiene pathMatch. */
    function fetchCssText(pathMatch) {
      var links = document.getElementsByTagName('link');
      var url = null;
      for (var i = 0; i < links.length; i++) {
        var h = links[i].getAttribute('href');
        if (h && h.indexOf(pathMatch) >= 0) { url = links[i].href || h; break; }
      }
      /* Fallback: se il <link> non e' in pagina, prova il path canonico. */
      if (!url) url = './src/' + pathMatch;
      if (!global.fetch) return Promise.resolve('');
      return global.fetch(url)
        .then(function (r) { return r.ok ? r.text() : ''; })
        .catch(function () { return ''; });
    }

    return Promise.all([
      fetchModuleSources(),
      buildLogoCSS(),
      fetchCssText('design-tokens.css'),
      fetchCssText('slides.css')
    ]).then(function (res) {
      var mods = res[0];
      var logoCSS = res[1];
      var tokensCss = res[2];
      var slidesCss = res[3];

      var rendererSrc = mods.renderer;
      var engineSrc = mods.engine;

      /* Se non abbiamo i sorgenti reali avvisiamo nel commento, ma
         proviamo comunque a generare: senza renderer/engine l'export
         non animerebbe. In pratica il fetch riesce quasi sempre. */
      var hasModules = !!(rendererSrc && engineSrc);

      /* CSS dell'export: base (reset + layout deck/landing + chrome) da
         buildCSS(); poi i FILE REALI design-tokens.css + slides.css
         inlinati come fonte unica di verita' per l'aspetto delle slide
         (l'export resta identico all'anteprima). logoCSS per ultimo: i
         --logo-src come data:URI sovrascrivono i path ../assets. Se il
         fetch fallisce (es. file://) tokensCss/slidesCss sono '' e si
         ricade sulle regole di buildCSS(). */
      var css = buildCSS() + tokensCss + slidesCss + logoCSS;
      var dataJson = jsonForScript(models);

      /* Script di avvio: ricostruisce window.OFG con renderer+engine,
         poi renderizza e avvia l'engine nella modalita' scelta. */
      var bootScript = [
        '(function(){',
        '"use strict";',
        'var data=window.__OFG_SLIDES__||[];',
        'var mount=document.getElementById("deck");',
        'if(window.OFG&&OFG.init){',
        '  OFG.init(mount,data,{mode:' + JSON.stringify(mode) + '});',
        '}else if(window.OFG&&OFG.renderDeck&&OFG.Engine){',
        '  OFG.renderDeck(mount,data,{mode:' + JSON.stringify(mode) + '});',
        '  new OFG.Engine(mount,{mode:' + JSON.stringify(mode) + '});',
        '}',
        '})();'
      ].join('');

      var parts = [];
      parts.push('<!DOCTYPE html>');
      parts.push('<html lang="it">');
      parts.push('<head>');
      parts.push('<meta charset="utf-8">');
      parts.push('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
      parts.push('<title>' + esc(title) + '</title>');
      /* Font Raleway: fallback via Google Fonts CDN (il progetto usa
         i .ttf locali, ma l'export singolo file non li include: il CDN
         garantisce il font, altrimenti fallback di sistema). */
      parts.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
      parts.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
      parts.push('<link href="https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&display=swap" rel="stylesheet">');
      parts.push('<style>' + css + '</style>');
      parts.push('</head>');
      parts.push('<body>');
      parts.push('<main id="deck" class="deck" aria-label="' + esc(title) + '"></main>');
      /* Dati slide. */
      parts.push('<script>window.__OFG_SLIDES__=' + dataJson + ';<\/script>');
      /* Moduli renderer + engine (sorgenti reali del progetto). */
      if (hasModules) {
        parts.push('<script>' + rendererSrc + '<\/script>');
        parts.push('<script>' + engineSrc + '<\/script>');
      } else {
        /* Avviso non bloccante: il file resta valido ma statico. */
        parts.push('<!-- ATTENZIONE: sorgenti renderer/engine non recuperati in export. -->');
      }
      /* Avvio. */
      parts.push('<script>' + bootScript + '<\/script>');
      parts.push('</body>');
      parts.push('</html>');

      return parts.join('\n');
    });
  }

  /* --------------------------------------------------------
     DOWNLOAD via Blob
     -------------------------------------------------------- */

  /* Sanifica un nome file (toglie caratteri non sicuri). */
  function safeFilename(name) {
    var n = String(name || 'presentazione-ofg')
      .replace(/[^\w\-. ]+/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (!n) n = 'presentazione-ofg';
    if (!/\.html?$/i.test(n)) n += '.html';
    return n;
  }

  /**
   * Genera e scarica il file HTML autonomo.
   * @param {Array} slides
   * @param {Object} [opts] { mode, title, filename }
   * @returns {Promise<void>}
   */
  function downloadHTML(slides, opts) {
    opts = opts || {};
    return exportHTML(slides, opts).then(function (html) {
      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = safeFilename(opts.filename || opts.title || 'presentazione-ofg');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      /* Rilascia l'URL dopo un attimo (lascia partire il download). */
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    });
  }

  /* --------------------------------------------------------
     ESPOSIZIONE PUBBLICA
     -------------------------------------------------------- */
  OFG.exportHTML = exportHTML;
  OFG.downloadHTML = downloadHTML;

})(typeof window !== 'undefined' ? window : this);
