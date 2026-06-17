/* ============================================================
   renderer.js — Modello Slide -> elemento DOM
   --------------------------------------------------------------
   App 100% client-side, nessuna dipendenza. Espone le funzioni
   sul namespace globale window.OFG (riusa OFG di parser.js).

   API PUBBLICA:
     OFG.renderSlide(slide)            -> HTMLElement (<section.slide ...>)
     OFG.renderDeck(container, slides, opts) -> Slide[] (svuota e popola)
     OFG.renderSlideHTML(slide)        -> string (per export statico)

   CONTRATTO DOM (l'engine vi si appoggia):
     <section class="slide slide--{type} theme-{theme}"
              data-type data-theme data-topic data-index
              id="slide-{index}" tabindex="-1"
              style="--bg:..;--fg:..;--accent:..">
       <span class="slide__logo"></span>   (opzionale, gestito da CSS via --logo-src)
       <div class="slide__inner"> ... </div>
     </section>

   ANIMAZIONI: gli elementi da rivelare portano la classe .reveal e
   la custom property --i (indice 0-based per lo stagger). La barretta
   gialla .bar parte a scaleX(0). L'engine aggiunge .is-visible.
   Variante d'ingresso opzionale via attributo data-anim
   ('fade'|'left'|'right'|'scale'); default = sli da basso.

   SICUREZZA: title/subtitle/body/bullets/kpi sono gia' HTML inline
   sicuro (parseInline) -> inseriti via innerHTML SENZA re-escape.
   image e' una stringa GREZZA -> usata solo come attributo src.
   ============================================================ */

(function (global) {
  'use strict';

  /* Namespace condiviso (creato da parser.js, riusato qui). */
  var OFG = (global.OFG = global.OFG || {});

  /* Colori brand per le variabili di tema inline sulla section.
     Tenuti coerenti con i blocchi .theme-* di slides.css: cosi'
     l'engine puo' animare il tema agendo SOLO su queste variabili. */
  var THEME_VARS = {
    light: {
      '--bg': '#ffffff',
      '--fg': '#111111',
      '--fg-soft': '#333333',
      '--accent': '#ffff00'
    },
    dark: {
      '--bg': '#000000',
      '--fg': '#ffffff',
      '--fg-soft': 'rgba(255,255,255,0.72)',
      '--accent': '#ffff00'
    }
  };

  /* --------------------------------------------------------
     UTILITY DOM
     -------------------------------------------------------- */

  /* Crea un elemento con classi opzionali. */
  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  /* Imposta innerHTML sicuro (il contenuto e' gia' passato da
     parseInline a monte: lo inseriamo senza re-escape). */
  function setHTML(node, html) {
    node.innerHTML = html != null ? html : '';
    return node;
  }

  /* Contrassegna un elemento come "da rivelare" assegnandogli la
     classe .reveal, l'indice di stagger --i e l'eventuale variante. */
  function reveal(node, i, anim) {
    node.classList.add('reveal');
    node.style.setProperty('--i', String(i || 0));
    if (anim) node.setAttribute('data-anim', anim);
    return node;
  }

  /* Risolve il tema su uno dei due valori ammessi (difensivo:
     il modello del parser e' gia' risolto, ma il renderer puo'
     ricevere oggetti costruiti a mano). */
  function resolveTheme(theme) {
    return theme === 'dark' ? 'dark' : (theme === 'light' ? 'light' : 'light');
  }

  /* Etichette di tipo per la EYEBROW quando manca il topic.
     Tengono coerente la sopra-linea su ogni slide della cornice. */
  /* Cover e closing NON hanno eyebrow di fallback: il logo e' gia' la
     firma del brand, un kicker "OFG" sarebbe ridondante e si accavalla.
     Compaiono solo se l'utente imposta un topic esplicito. */
  var TYPE_LABELS = {
    cover: '',
    section: 'Capitolo',
    text: 'Approfondimento',
    bullets: 'Punti chiave',
    kpi: 'Numeri',
    quote: 'Citazione',
    image: 'Visual',
    split: 'Focus',
    closing: '',
    table: 'Dati'
  };

  /* Numero a due cifre con padding ('3' -> '03'). */
  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }

  /* --------------------------------------------------------
     COMPONENTI RIUSABILI
     -------------------------------------------------------- */

  /* Titolo standard H2 con barretta gialla animata sotto.
     Ritorna un fragment-like wrapper (l'H2 e la barra sono due
     elementi .reveal con --i consecutivi per uno stagger pulito). */
  function buildHeading(titleHtml, startIndex) {
    var frag = document.createDocumentFragment();
    var i = startIndex || 0;

    var h = el('h2', 'h2');
    setHTML(h, titleHtml);
    reveal(h, i);
    frag.appendChild(h);

    /* Barretta gialla: e' un .reveal indipendente cosi' l'engine,
       aggiungendo .is-visible, ne fa partire il draw-in (scaleX). */
    var bar = el('span', 'bar reveal');
    bar.style.setProperty('--i', String(i + 1));
    bar.setAttribute('aria-hidden', 'true');
    frag.appendChild(bar);

    return frag;
  }

  /* COLONNA TESTATA (layout editoriale a due colonne): raccoglie
     eyebrow + titolo (con barretta) + sottotitolo in un blocco a
     sinistra. Le slide di contenuto (text/bullets/kpi/table) mettono
     il contenuto vero nella colonna destra: cosi' la slide riempie
     l'intera larghezza invece di lasciare meta' pagina vuota. */
  function buildHead(slide, type) {
    var head = el('div', 'slide__head');
    var i = 0;
    var eb = buildEyebrow(slide, type);
    if (eb) { head.appendChild(eb); i++; }
    if (slide.title) { head.appendChild(buildHeading(slide.title, i)); i += 2; }
    if (slide.subtitle) {
      var s = el('p', 'subtitle');
      setHTML(s, slide.subtitle);
      reveal(s, i++);
      head.appendChild(s);
    }
    return head;
  }

  /* Corpo: spezza la stringa 'body' su '\n' in piu' <p>. */
  function buildBody(bodyHtml, startIndex) {
    var wrap = el('div', 'body');
    var parts = String(bodyHtml || '').split('\n');
    var i = startIndex || 0;
    for (var p = 0; p < parts.length; p++) {
      var text = parts[p].trim();
      if (text === '') continue;
      var para = el('p');
      setHTML(para, text);
      reveal(para, i++);
      wrap.appendChild(para);
    }
    return wrap;
  }

  /* Blocco media: immagine reale oppure placeholder geometrico.
     duotone=true applica il trattamento on-brand nero/giallo. */
  function buildMedia(imageSrc, opts) {
    opts = opts || {};

    /* Risolve i riferimenti "img:ID" dello store immagini (se caricato).
       OFG.images.resolve restituisce: il dataURI per "img:ID" presenti,
       null per "img:ID" mancanti, e il valore invariato per url/data/path.
       Nell'HTML esportato lo store non c'e': li' l'immagine e' gia' stata
       sostituita col dataURI a monte (vedi export.js), quindi nessun lookup. */
    var resolved = imageSrc;
    if (OFG && OFG.images && typeof OFG.images.resolve === 'function'
        && /^img:/i.test(String(imageSrc))) {
      resolved = OFG.images.resolve(imageSrc);
    }
    var hasImg = resolved && String(resolved).trim() !== '';

    var cls = 'media';
    if (opts.duotone) cls += ' media--duotone';
    if (!hasImg) cls += ' media--placeholder';

    var media = el('figure', cls);
    media.style.margin = '0';

    if (hasImg) {
      var img = el('img', 'media__img');
      /* image e' GREZZA: usata solo come src, mai come HTML. */
      img.src = String(resolved);
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      /* Inquadratura personalizzata (crop/posizione/zoom non distruttivi):
         applicata come stili inline cosi' viaggia anche nell'export. */
      var io = opts.opts;
      if (io) {
        if (io.fit) img.style.objectFit = io.fit;
        if (typeof io.posX === 'number' || typeof io.posY === 'number') {
          var px = typeof io.posX === 'number' ? io.posX : 50;
          var py = typeof io.posY === 'number' ? io.posY : 50;
          img.style.objectPosition = px + '% ' + py + '%';
        }
        if (typeof io.zoom === 'number' && io.zoom !== 1) {
          img.style.transform = 'scale(' + io.zoom + ')';
          img.style.transformOrigin = 'center center';
        }
      }
      /* Se l'immagine fallisce il caricamento, degradiamo
         elegantemente al placeholder geometrico. */
      img.addEventListener('error', function () {
        media.classList.add('media--placeholder');
        media.classList.remove('media--duotone');
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      media.appendChild(img);
    } else {
      /* Placeholder: descrizione accessibile. */
      media.setAttribute('role', 'img');
      media.setAttribute('aria-label', 'Immagine non disponibile');
    }

    return media;
  }

  /* Logo firma della cornice: posizione FISSA in alto a sinistra su
     TUTTE le slide. Renderizzato UNA sola volta per slide (in
     renderSlide), mai dentro i singoli render per tipo: cosi' non si
     sovrappone mai al contenuto. Sorgente nero/negativo via --logo-src. */
  function buildLogo() {
    var logo = el('span', 'slide__logo');
    logo.setAttribute('aria-hidden', 'true');
    return logo;
  }

  /* EYEBROW / KICKER della cornice: sopra-linea uppercase sopra il
     titolo. Usa slide.topic se presente, altrimenti l'etichetta del
     tipo. E' un .reveal (entra per primo, --i = 0). */
  function buildEyebrow(slide, type) {
    var label = (slide.topic && String(slide.topic).trim())
      ? String(slide.topic).trim()
      : (TYPE_LABELS[type] || '');
    if (!label) return null;
    var eb = el('p', 'eyebrow');
    eb.textContent = label; /* testo grezzo: niente HTML inline qui */
    reveal(eb, 0, 'fade');
    return eb;
  }

  /* NUMERO SLIDE della cornice: indicatore discreto in basso a destra
     "NN / TOT". Il totale arriva via --slide-total (impostato in
     renderDeck); qui scriviamo l'indice e leggiamo il totale via CSS
     counter non e' affidabile, quindi passiamo total esplicito quando
     disponibile e lasciamo il fallback su attributo. */
  function buildPageNo(index, total) {
    var n = (typeof index === 'number' ? index : 0) + 1;
    var box = el('div', 'slide__pageno');
    box.setAttribute('aria-hidden', 'true');
    var b = el('b');
    b.textContent = pad2(n);
    box.appendChild(b);
    if (typeof total === 'number' && total > 0) {
      var sep = document.createTextNode('/');
      var i = el('i');
      i.textContent = pad2(total);
      box.appendChild(sep);
      box.appendChild(i);
    }
    return box;
  }

  /* --------------------------------------------------------
     RENDER PER TIPO
     Ogni funzione popola .slide__inner; ritorna nulla (muta inner).
     Il parametro 'idx' di partenza per --i e' gestito localmente.
     -------------------------------------------------------- */

  function renderCover(slide, inner) {
    var eb = buildEyebrow(slide, 'cover');
    if (eb) inner.appendChild(eb);

    var i = 1;
    if (slide.title) {
      var t = el('h1', 'cover__title');
      setHTML(t, slide.title);
      reveal(t, i++, 'scale');
      inner.appendChild(t);
    }

    var bar = el('span', 'bar reveal');
    bar.style.setProperty('--i', String(i++));
    bar.setAttribute('aria-hidden', 'true');
    inner.appendChild(bar);

    if (slide.subtitle) {
      var s = el('p', 'subtitle');
      setHTML(s, slide.subtitle);
      reveal(s, i++);
      inner.appendChild(s);
    }
  }

  function renderSection(slide, inner) {
    var i = 0;

    /* Numero di capitolo gigante in outline giallo (deriva dall'index). */
    var num = el('div', 'section__num');
    var idx = (typeof slide.index === 'number' ? slide.index : 0) + 1;
    num.textContent = pad2(idx);
    num.setAttribute('aria-hidden', 'true');
    reveal(num, i++, 'left');
    inner.appendChild(num);

    var eb = buildEyebrow(slide, 'section');
    if (eb) { reveal(eb, i++, 'fade'); inner.appendChild(eb); }

    if (slide.title) {
      var t = el('h2', 'section__title');
      setHTML(t, slide.title);
      reveal(t, i++, 'left');
      inner.appendChild(t);
    }

    var bar = el('span', 'bar reveal');
    bar.style.setProperty('--i', String(i++));
    bar.setAttribute('aria-hidden', 'true');
    inner.appendChild(bar);

    if (slide.subtitle) {
      var s = el('p', 'subtitle');
      setHTML(s, slide.subtitle);
      reveal(s, i++);
      inner.appendChild(s);
    }
  }

  function renderText(slide, inner) {
    inner.appendChild(buildHead(slide, 'text'));
    var content = el('div', 'slide__content');
    if (slide.body) content.appendChild(buildBody(slide.body, 0));
    inner.appendChild(content);
  }

  function renderBullets(slide, inner) {
    inner.appendChild(buildHead(slide, 'bullets'));

    var content = el('div', 'slide__content');
    var ul = el('ul', 'bullets');
    for (var b = 0; b < slide.bullets.length; b++) {
      var li = el('li', 'bullet');
      reveal(li, b, 'left');

      /* Indice numerato grande (scheda editoriale, non pallino piatto). */
      var n = el('span', 'bullet__n');
      n.textContent = pad2(b + 1);
      n.setAttribute('aria-hidden', 'true');
      li.appendChild(n);

      var txt = el('span', 'bullet__t');
      setHTML(txt, slide.bullets[b]);
      li.appendChild(txt);

      ul.appendChild(li);
    }
    content.appendChild(ul);
    inner.appendChild(content);
  }

  function renderKpi(slide, inner) {
    inner.appendChild(buildHead(slide, 'kpi'));

    var content = el('div', 'slide__content');
    var grid = el('div', 'kpi-grid');
    for (var k = 0; k < slide.kpi.length; k++) {
      var item = slide.kpi[k] || {};
      var card = el('div', 'kpi-card');
      reveal(card, k, 'scale');

      var v = el('div', 'kpi-card__v');
      setHTML(v, item.v);
      card.appendChild(v);

      var kk = el('div', 'kpi-card__k');
      setHTML(kk, item.k);
      card.appendChild(kk);

      grid.appendChild(card);
    }
    content.appendChild(grid);
    inner.appendChild(content);
  }

  function renderQuote(slide, inner) {
    var i = 0;
    var eb = buildEyebrow(slide, 'quote');
    if (eb) { reveal(eb, i++, 'fade'); inner.appendChild(eb); }

    var mark = el('div', 'quote__mark');
    mark.textContent = '“'; /* virgolette caporali aperte */
    mark.setAttribute('aria-hidden', 'true');
    reveal(mark, i++, 'scale');
    inner.appendChild(mark);

    /* Il testo della citazione e' nel body (il parser ci mette i '> '). */
    var q = el('blockquote', 'quote__text');
    q.style.margin = '0';
    setHTML(q, slide.body || slide.title);
    reveal(q, i++);
    inner.appendChild(q);

    if (slide.subtitle) {
      var cite = el('p', 'quote__cite');
      setHTML(cite, slide.subtitle);
      reveal(cite, i++, 'left');
      inner.appendChild(cite);
    }
  }

  function renderImage(slide, inner) {
    /* La foto piena va FUORI da .slide__inner (sotto, coprente);
       l'inner contiene solo il titolo in overlay. La gestiamo in
       renderSlide aggiungendo la media direttamente alla section. */
    var i = 0;
    var eb = buildEyebrow(slide, 'image');
    if (eb) { reveal(eb, i++, 'fade'); inner.appendChild(eb); }
    if (slide.title) {
      var h = el('h2', 'h2');
      setHTML(h, slide.title);
      reveal(h, i++);
      inner.appendChild(h);
    }
    if (slide.subtitle) {
      var s = el('p', 'subtitle');
      setHTML(s, slide.subtitle);
      reveal(s, i++);
      inner.appendChild(s);
    }
  }

  function renderSplit(slide, inner) {
    /* Layout a due colonne: testo a sinistra, media a destra. */
    var textCol = el('div', 'split__text');

    var i = 0;
    var eb = buildEyebrow(slide, 'split');
    if (eb) { reveal(eb, i++, 'fade'); textCol.appendChild(eb); }
    if (slide.title) { textCol.appendChild(buildHeading(slide.title, i)); i += 2; }
    if (slide.subtitle) {
      var s = el('p', 'subtitle');
      setHTML(s, slide.subtitle);
      reveal(s, i++);
      textCol.appendChild(s);
    }
    if (slide.body) textCol.appendChild(buildBody(slide.body, i));

    var mediaCol = el('div', 'split__media');
    var media = buildMedia(slide.image, { duotone: false, opts: slide.imageOpts });
    reveal(media, 0, 'right');
    mediaCol.appendChild(media);

    inner.appendChild(textCol);
    inner.appendChild(mediaCol);
  }

  function renderClosing(slide, inner) {
    var i = 0;
    var eb = buildEyebrow(slide, 'closing');
    if (eb) { reveal(eb, i++, 'fade'); inner.appendChild(eb); }
    if (slide.title) {
      var t = el('h2', 'closing__title');
      setHTML(t, slide.title);
      reveal(t, i++, 'scale');
      inner.appendChild(t);
    }

    var bar = el('span', 'bar reveal');
    bar.style.setProperty('--i', String(i++));
    bar.setAttribute('aria-hidden', 'true');
    inner.appendChild(bar);

    if (slide.subtitle) {
      var s = el('p', 'subtitle');
      setHTML(s, slide.subtitle);
      reveal(s, i++);
      inner.appendChild(s);
    }
  }

  /* Slide TABELLA: titolo opzionale + tabella dati on-brand. */
  function renderTable(slide, inner) {
    inner.appendChild(buildHead(slide, 'table'));
    var content = el('div', 'slide__content');

    var t = slide.table || { headers: [], rows: [] };
    var wrap = el('div', 'table-wrap');
    var table = el('table', 'data-table');

    if (t.headers && t.headers.length) {
      var thead = el('thead');
      var trh = el('tr');
      for (var c = 0; c < t.headers.length; c++) {
        var th = el('th');
        setHTML(th, t.headers[c]);
        trh.appendChild(th);
      }
      thead.appendChild(trh);
      table.appendChild(thead);
    }

    var tbody = el('tbody');
    var rows = t.rows || [];
    for (var r = 0; r < rows.length; r++) {
      var tr = el('tr');
      for (var cc = 0; cc < rows[r].length; cc++) {
        var td = el('td');
        setHTML(td, rows[r][cc]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    reveal(wrap, 0);
    content.appendChild(wrap);
    inner.appendChild(content);
  }

  /* Tabella di dispatch tipo -> renderer. */
  var RENDERERS = {
    cover: renderCover,
    section: renderSection,
    text: renderText,
    bullets: renderBullets,
    kpi: renderKpi,
    quote: renderQuote,
    image: renderImage,
    split: renderSplit,
    closing: renderClosing,
    table: renderTable
  };

  /* --------------------------------------------------------
     RENDER DI UNA SLIDE COMPLETA
     -------------------------------------------------------- */
  function renderSlide(slide, total) {
    slide = slide || {};
    var type = RENDERERS[slide.type] ? slide.type : 'text';
    var theme = resolveTheme(slide.theme);
    var index = typeof slide.index === 'number' ? slide.index : 0;
    var topic = slide.topic || '';

    var section = el('section', 'slide slide--' + type + ' theme-' + theme);
    section.setAttribute('data-type', type);
    section.setAttribute('data-theme', theme);
    section.setAttribute('data-topic', topic);
    section.setAttribute('data-index', String(index));
    section.id = 'slide-' + index;
    section.setAttribute('tabindex', '-1');

    /* Variabili tema inline (l'engine le anima al cambio slide). */
    var vars = THEME_VARS[theme];
    for (var key in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, key)) {
        section.style.setProperty(key, vars[key]);
      }
    }

    /* La slide IMAGE ha la foto piena sotto l'inner (overlay). */
    if (type === 'image') {
      var media = buildMedia(slide.image, { duotone: false, opts: slide.imageOpts });
      section.appendChild(media);
    }

    var inner = el('div', 'slide__inner');
    RENDERERS[type](slide, inner);
    section.appendChild(inner);

    /* CORNICE COERENTE: logo + numero slide, identici su OGNI slide.
       Renderizzati UNA sola volta qui (mai nei render per tipo), in
       posizione fissa, fuori dal flusso del contenuto: non si
       sovrappongono mai al testo. */
    section.appendChild(buildLogo());

    /* Totale: argomento esplicito (renderDeck) oppure --slide-total
       letto dal container in fase di export/montaggio. Se ignoto,
       mostriamo solo il numero corrente. */
    var tot = (typeof total === 'number' && total > 0) ? total : 0;
    section.appendChild(buildPageNo(index, tot));

    return section;
  }

  /* --------------------------------------------------------
     RENDER DELL'INTERO DECK
     Svuota il contenitore, applica le classi di modalita',
     crea le slide e ritorna i modelli usati.
     -------------------------------------------------------- */
  function renderDeck(container, slides, opts) {
    opts = opts || {};
    var mode = opts.mode === 'landing' ? 'landing' : 'deck';
    slides = Array.isArray(slides) ? slides : [];

    if (!container) return slides;

    /* Svuota il contenitore in modo efficiente. */
    while (container.firstChild) container.removeChild(container.firstChild);

    /* Classi di modalita' sul contenitore (l'engine vi si appoggia). */
    container.classList.add('deck');
    container.classList.remove('deck--deck', 'deck--landing');
    container.classList.add('deck--' + mode);
    container.setAttribute('data-mode', mode);

    /* Totale slide per l'indicatore "NN / TOT" della cornice:
       impostato come variabile CSS sul container (robusto, leggibile
       sia in app sia nell'export) e passato a renderSlide. */
    var total = slides.length;
    container.style.setProperty('--slide-total', String(total));
    container.setAttribute('data-total', String(total));

    /* Crea le slide. Usiamo un fragment per un singolo reflow. */
    var frag = document.createDocumentFragment();
    for (var i = 0; i < slides.length; i++) {
      /* Garantiamo che l'index del DOM segua la posizione reale. */
      var model = slides[i];
      if (model && typeof model.index !== 'number') model.index = i;
      frag.appendChild(renderSlide(model, total));
    }
    container.appendChild(frag);

    return slides;
  }

  /* --------------------------------------------------------
     HTML STRINGA (per export statico)
     -------------------------------------------------------- */
  function renderSlideHTML(slide, total) {
    var node = renderSlide(slide, total);
    return node.outerHTML;
  }

  /* --------------------------------------------------------
     ESPORTAZIONE SUL NAMESPACE
     -------------------------------------------------------- */
  OFG.renderSlide = renderSlide;
  OFG.renderDeck = renderDeck;
  OFG.renderSlideHTML = renderSlideHTML;
  /* Esposte come utility per gli altri moduli (engine/export). */
  OFG.THEME_VARS = THEME_VARS;
})(typeof window !== 'undefined' ? window : this);
