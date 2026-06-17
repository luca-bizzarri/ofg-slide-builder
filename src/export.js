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
      /* ---- Deck container + slide base ---- */
      '.deck{position:relative;width:100vw;height:100dvh;background:var(--black);--slide-total:0}',
      '.slide{position:relative;width:100%;min-height:100dvh;display:flex;',
      'align-items:center;justify-content:center;overflow:hidden;background:var(--bg);',
      'color:var(--fg);--frame-top:clamp(2.75rem,7vh,5.5rem);',
      'transition:background-color var(--dur-theme) var(--ease-out),',
      'color var(--dur-theme) var(--ease-out)}',
      '.slide__inner{position:relative;z-index:var(--z-slide-content);width:100%;',
      'max-width:var(--slide-max-w);padding:var(--slide-pad);',
      'padding-top:calc(var(--slide-pad) + var(--frame-top));',
      'padding-bottom:calc(var(--slide-pad) + var(--sp-6));display:flex;',
      'flex-direction:column;gap:var(--sp-5)}',
      /* CORNICE: logo fisso in alto a sinistra (uguale su ogni slide) */
      '.slide__logo{position:absolute;top:var(--slide-pad);left:var(--slide-pad);',
      'width:clamp(72px,8vw,116px);height:clamp(22px,2.6vw,34px);',
      'z-index:calc(var(--z-slide-content) + 2);background-image:var(--logo-src);',
      'background-repeat:no-repeat;background-position:left center;',
      'background-size:contain;pointer-events:none}',
      /* CORNICE: eyebrow/kicker con micro-tratto giallo */
      '.eyebrow{display:inline-flex;align-items:center;gap:var(--sp-3);margin:0;',
      'font-size:var(--fs-small);font-weight:var(--fw-bold);text-transform:uppercase;',
      'letter-spacing:.18em;color:var(--fg-soft);white-space:nowrap}',
      ".eyebrow::before{content:'';width:clamp(20px,2.4vw,32px);height:3px;",
      'background:var(--accent);border-radius:var(--radius-pill);flex:0 0 auto}',
      /* CORNICE: numero slide in basso a destra "NN / TOT" */
      '.slide__pageno{position:absolute;bottom:var(--slide-pad);right:var(--slide-pad);',
      'z-index:calc(var(--z-slide-content) + 2);font-size:var(--fs-small);',
      'font-weight:var(--fw-semibold);letter-spacing:var(--ls-caps);color:var(--fg-soft);',
      'font-variant-numeric:tabular-nums;pointer-events:none;display:flex;',
      'align-items:baseline;gap:.35em}',
      '.slide__pageno b{font-weight:var(--fw-black);color:var(--fg)}',
      '.slide__pageno i{font-style:normal;opacity:.55}',
      /* ---- Tipografia condivisa ---- */
      '.h2{margin:0;font-size:var(--fs-h2);font-weight:var(--fw-black);',
      'line-height:var(--lh-heading);letter-spacing:var(--ls-tight);',
      'text-transform:uppercase;color:var(--fg)}',
      '.bar{display:block;width:var(--bar-w);height:var(--bar-h);',
      'margin-top:var(--sp-4);background:var(--accent);border-radius:var(--radius-pill);',
      'transform:scaleX(0);transform-origin:left center}',
      '.subtitle{margin:0;font-size:var(--fs-lead);font-weight:var(--fw-light);',
      'line-height:var(--lh-heading);color:var(--fg-soft)}',
      '.body{display:flex;flex-direction:column;gap:var(--sp-4)}',
      '.body p{margin:0;font-size:var(--fs-body);font-weight:var(--fw-regular);',
      'line-height:var(--lh-body);color:var(--fg);max-width:62ch}',
      '.slide strong{font-weight:var(--fw-bold)}.slide em{font-style:italic}',
      ".slide code{font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;",
      'font-size:.9em;padding:.1em .4em;border-radius:var(--radius-sm);',
      'background:var(--hairline);color:var(--fg)}',
      '.slide mark{background:var(--accent);color:var(--black);padding:.02em .22em;',
      'border-radius:var(--radius-sm);font-weight:var(--fw-semibold)}',
      '.slide a{color:var(--fg);text-decoration:underline;',
      'text-decoration-color:var(--accent);text-decoration-thickness:2px;',
      'text-underline-offset:3px}',
      /* ---- Tipi slide ---- */
      '.slide--cover .slide__inner{align-items:flex-start;text-align:left;',
      'justify-content:flex-end;min-height:100dvh;gap:var(--sp-5)}',
      '.slide--cover .cover__title{margin:0;font-size:var(--fs-display);',
      'font-weight:var(--fw-black);line-height:var(--lh-tight);',
      'letter-spacing:var(--ls-display);text-transform:uppercase;text-wrap:balance}',
      '.slide--cover .subtitle{font-size:var(--fs-lead);text-transform:uppercase;',
      'letter-spacing:var(--ls-caps);font-weight:var(--fw-medium);color:var(--fg)}',
      '.slide--cover .bar{width:calc(var(--bar-w)*1.4)}',
      ".slide--cover::after{content:'';position:absolute;top:12%;right:-10vmin;",
      'width:52vmin;height:52vmin;border:var(--bar-h) solid var(--accent);',
      'border-radius:var(--radius-lg);opacity:.14;transform:rotate(-12deg);',
      'pointer-events:none;z-index:0}',
      '.slide--section .slide__inner{align-items:flex-start;text-align:left;',
      'justify-content:center;gap:var(--sp-5)}',
      '.section__num{margin:0;font-size:clamp(5rem,22vw,18rem);font-weight:var(--fw-black);',
      'line-height:.82;letter-spacing:var(--ls-display);color:transparent;',
      '-webkit-text-stroke:clamp(2px,.4vw,4px) var(--accent);',
      'text-stroke:clamp(2px,.4vw,4px) var(--accent);opacity:.9}',
      '.slide--section .section__title{margin:0;font-size:var(--fs-h1);',
      'font-weight:var(--fw-extrabold);line-height:var(--lh-tight);',
      'letter-spacing:var(--ls-display);text-transform:uppercase;text-wrap:balance}',
      '.slide--section .bar{width:calc(var(--bar-w)*2)}',
      '.slide--text .slide__inner,.slide--bullets .slide__inner,',
      '.slide--kpi .slide__inner{align-items:flex-start;text-align:left}',
      '.bullets{list-style:none;margin:0;padding:0;display:flex;',
      'flex-direction:column;gap:var(--sp-5);width:100%}',
      '.bullets li{position:relative;padding-left:var(--sp-7);font-size:var(--fs-lead);',
      'font-weight:var(--fw-regular);line-height:var(--lh-heading);color:var(--fg);',
      'max-width:56ch}',
      ".bullets li::before{content:'';position:absolute;left:0;top:.5em;width:1.4em;",
      'height:.2em;background:var(--accent);border-radius:var(--radius-pill)}',
      '.kpi-grid{display:grid;',
      'grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));',
      'gap:var(--sp-4);width:100%}',
      '.kpi-card{background:var(--black);color:var(--white);',
      'border-radius:var(--radius-lg);padding:var(--sp-6) var(--sp-5);display:flex;',
      'flex-direction:column;gap:var(--sp-2);border:1px solid rgba(255,255,255,.08);',
      'box-shadow:var(--shadow-md)}',
      '.kpi-card__v{font-size:var(--fs-kpi);font-weight:var(--fw-black);',
      'line-height:var(--lh-tight);letter-spacing:var(--ls-display);color:var(--white)}',
      '.kpi-card__v mark{background:transparent;color:var(--accent);padding:0}',
      '.kpi-card__k{font-size:var(--fs-small);font-weight:var(--fw-medium);',
      'text-transform:uppercase;letter-spacing:var(--ls-caps);color:rgba(255,255,255,.7)}',
      ".kpi-card::before{content:'';display:block;width:var(--bar-w);height:var(--bar-h);",
      'background:var(--accent);border-radius:var(--radius-pill);margin-bottom:var(--sp-3)}',
      '.slide--quote .slide__inner{align-items:flex-start;text-align:left;',
      'gap:var(--sp-5);max-width:64rem}',
      '.quote__mark{font-size:clamp(5rem,14vw,11rem);font-weight:var(--fw-black);',
      'line-height:.6;color:var(--accent);height:.45em}',
      '.quote__text{margin:0;font-size:clamp(1.7rem,4.6vw,3.2rem);',
      'font-weight:var(--fw-light);line-height:1.18;letter-spacing:var(--ls-tight);',
      'text-wrap:balance}',
      '.quote__cite{margin:0;font-size:var(--fs-lead);font-weight:var(--fw-semibold);',
      'text-transform:uppercase;letter-spacing:var(--ls-caps);color:var(--fg-soft);',
      'display:inline-flex;align-items:center;gap:var(--sp-3)}',
      ".quote__cite::before{content:'';width:clamp(24px,3vw,40px);height:3px;",
      'background:var(--accent);border-radius:var(--radius-pill)}',
      '.slide--image .media,.slide--image .media__img{position:absolute;inset:0;',
      'width:100%;height:100%}',
      '.slide--image .media__img{object-fit:cover}',
      ".slide--image::before{content:'';position:absolute;inset:0;z-index:1;",
      'background:linear-gradient(to top,rgba(0,0,0,.8) 0%,rgba(0,0,0,0) 55%),',
      'linear-gradient(to bottom,rgba(0,0,0,.45) 0%,rgba(0,0,0,0) 30%);',
      'pointer-events:none}',
      '.slide--image .slide__inner{align-self:flex-end;align-items:flex-start;',
      'justify-content:flex-end;text-align:left;min-height:100dvh}',
      '.slide--image .h2,.slide--image .subtitle,.slide--image .eyebrow,',
      '.slide--image .slide__pageno b{color:var(--white)}',
      '.slide--image .slide__pageno,.slide--image .eyebrow{color:rgba(255,255,255,.78)}',
      '.slide--split{padding:0}',
      '.slide--split .slide__inner{flex-direction:row;align-items:stretch;gap:0;',
      'max-width:none;padding:0;padding-top:0;padding-bottom:0}',
      '.split__text{flex:1 1 55%;min-width:0;padding:var(--slide-pad);',
      'padding-top:calc(var(--slide-pad) + var(--frame-top));display:flex;',
      'flex-direction:column;justify-content:center;gap:var(--sp-5)}',
      '.split__media{flex:1 1 45%;min-width:0;position:relative}',
      '.split__media .media,.split__media .media__img{position:absolute;inset:0;',
      'width:100%;height:100%}',
      '.split__media .media__img{object-fit:cover}',
      '.slide--closing .slide__inner{align-items:center;text-align:center;',
      'justify-content:center;gap:var(--sp-5)}',
      '.slide--closing .eyebrow{align-self:center}',
      '.slide--closing .closing__title{margin:0;font-size:var(--fs-display);',
      'font-weight:var(--fw-black);line-height:var(--lh-tight);',
      'letter-spacing:var(--ls-display);text-transform:uppercase;text-wrap:balance}',
      '.slide--closing .subtitle{font-size:var(--fs-lead);letter-spacing:var(--ls-caps);',
      'text-align:center;max-width:48ch}',
      '.slide--closing .bar{margin-inline:auto;transform-origin:center;',
      'width:calc(var(--bar-w)*1.4)}',
      /* ---- Media + placeholder + duotone ---- */
      '.media{position:relative;display:block;width:100%;overflow:hidden;',
      'background:var(--black)}',
      '.media__img{display:block;width:100%;height:100%;object-fit:cover}',
      '.media--duotone .media__img{filter:grayscale(1) contrast(1.1) brightness(.95)}',
      ".media--duotone::after{content:'';position:absolute;inset:0;",
      'background:var(--accent);mix-blend-mode:multiply;opacity:.85;pointer-events:none}',
      '.media--placeholder{background-color:var(--black);background-image:',
      'repeating-linear-gradient(45deg,transparent 0,transparent 22px,',
      'rgba(255,255,0,.12) 22px,rgba(255,255,0,.12) 24px),',
      'radial-gradient(circle at 30% 30%,rgba(255,255,0,.16),transparent 60%)}',
      ".media--placeholder::after{content:'';position:absolute;top:50%;left:50%;",
      'width:22%;aspect-ratio:1;transform:translate(-50%,-50%) rotate(45deg);',
      'border:4px solid var(--accent);border-radius:var(--radius-md);opacity:.85}',
      /* ---- Animazioni reveal ---- */
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
      /* ---- Tabelle (parita' con slides.css) ---- */
      '.slide--table .slide__inner{align-items:flex-start}',
      '.table-wrap{width:100%;max-height:64vh;overflow:auto;border:1px solid var(--hairline);border-radius:10px}',
      '.data-table{width:100%;border-collapse:collapse;font-size:clamp(13px,1.35vw,18px);font-variant-numeric:tabular-nums;color:var(--fg)}',
      '.data-table th,.data-table td{text-align:left;padding:clamp(8px,1vw,14px) clamp(10px,1.2vw,18px);border-bottom:1px solid var(--hairline);vertical-align:top}',
      '.data-table thead th{position:sticky;top:0;z-index:1;background:var(--accent);color:#000;font-weight:800;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}',
      '.data-table tbody tr:nth-child(even){background:color-mix(in srgb,var(--fg) 7%,transparent)}',
      '.data-table tbody tr:last-child td{border-bottom:none}',
      /* ---- Responsive ---- */
      '@media (max-width:768px){',
      '.slide{--frame-top:clamp(2.5rem,9vh,4rem)}',
      '.slide--split .slide__inner{flex-direction:column}',
      '.split__text,.split__media{flex:1 1 auto;min-height:38dvh}',
      '.split__text{padding-top:calc(var(--slide-pad) + var(--frame-top))}',
      '.kpi-grid{grid-template-columns:1fr}',
      '.section__num{font-size:clamp(4rem,30vw,9rem)}',
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
