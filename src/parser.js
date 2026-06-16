/* ============================================================
   parser.js — Markdown OFG -> array di modelli slide (JSON)
   --------------------------------------------------------------
   App 100% client-side, nessuna dipendenza. Espone le funzioni
   sul namespace globale window.OFG.

   API PUBBLICA:
     window.OFG.parse(markdownString)  -> Slide[]
     window.OFG.parseInline(text)      -> string (HTML inline sicuro)
     window.OFG.SLIDE_TYPES            -> string[] (tipi validi)
     window.OFG.escapeHtml(text)       -> string

   Il parser e' ROBUSTO a input incompleti: campi mancanti
   diventano valori di default, un tipo sconosciuto degrada a
   'text', e non lancia mai eccezioni su input malformato.
   ============================================================ */

(function (global) {
  'use strict';

  /* Namespace condiviso (riusato se gia' esistente). */
  var OFG = (global.OFG = global.OFG || {});

  /* Tipi di slide riconosciuti. L'ordine non e' significativo. */
  var SLIDE_TYPES = [
    'cover',    // copertina: fondo scuro, titolo hero centrato
    'section',  // divider di categoria
    'text',     // titolo + paragrafo
    'bullets',  // titolo + elenco puntato
    'kpi',      // titolo + card numeriche
    'quote',    // citazione grande
    'image',    // foto a piena pagina
    'split',    // testo + foto affiancati
    'closing'   // chiusura / call to action
  ];

  /* Temi ammessi. */
  var THEMES = ['light', 'dark'];

  /* Tema di default per ciascun tipo (puo' essere sovrascritto
     dalla direttiva 'theme:' nel blocco). */
  var DEFAULT_THEME_BY_TYPE = {
    cover: 'dark',
    section: 'dark',
    text: 'light',
    bullets: 'light',
    kpi: 'dark',
    quote: 'dark',
    image: 'dark',
    split: 'light',
    closing: 'dark'
  };

  /* --------------------------------------------------------
     UTILITY
     -------------------------------------------------------- */

  /* Escape dei caratteri HTML pericolosi: l'output del parser
     finisce in innerHTML, quindi va sempre sanitizzato. */
  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Parser markdown INLINE minimale: prima fa escape, poi
     riapplica un set ristretto e sicuro di formattazioni.
     Supporta: **grassetto**, *corsivo*, `code`, ==evidenziato==
     (accento giallo), [testo](url) con sole url http/https/#/relative.
     Ritorna una stringa HTML. */
  function parseInline(text) {
    if (text == null) return '';
    var s = escapeHtml(text);

    /* Codice inline `...` (prima degli altri per non interpretare
       il loro markup all'interno). */
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

    /* Link [testo](url) — url filtrata per evitare javascript: ecc. */
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      if (/^(https?:\/\/|\/|\.\/|#|mailto:)/i.test(url)) {
        return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
      }
      return label; // url non sicura: mostra solo il testo
    });

    /* ==evidenziato== -> accento giallo (mark on-brand). */
    s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    /* **grassetto** */
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    /* *corsivo* (evita di toccare ** gia' consumati). */
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    return s;
  }

  /* Normalizza il nome del tipo: minuscolo, trim, alias comuni. */
  function normalizeType(raw) {
    if (!raw) return null;
    var t = String(raw).trim().toLowerCase();
    var aliases = {
      title: 'cover',
      copertina: 'cover',
      divider: 'section',
      categoria: 'section',
      paragraph: 'text',
      paragrafo: 'text',
      list: 'bullets',
      elenco: 'bullets',
      stats: 'kpi',
      numbers: 'kpi',
      citazione: 'quote',
      photo: 'image',
      foto: 'image',
      immagine: 'image',
      duo: 'split',
      end: 'closing',
      chiusura: 'closing'
    };
    if (aliases[t]) t = aliases[t];
    return SLIDE_TYPES.indexOf(t) !== -1 ? t : null;
  }

  /* Normalizza il tema su uno dei valori ammessi, altrimenti null. */
  function normalizeTheme(raw) {
    if (!raw) return null;
    var t = String(raw).trim().toLowerCase();
    if (t === 'nero' || t === 'scuro' || t === 'black') t = 'dark';
    if (t === 'bianco' || t === 'chiaro') t = 'light';
    return THEMES.indexOf(t) !== -1 ? t : null;
  }

  /* --------------------------------------------------------
     ESTRAZIONE DIRETTIVE
     Riconosce le righe-direttiva che dichiarano metadati:
       :: cover
       <!-- type: cover -->
       theme: dark
       topic: Risultati
       image: ./foto.jpg
       note: testo per il presentatore
     Ritorna {key, value} oppure null se la riga non e' una direttiva.
     -------------------------------------------------------- */
  function matchDirective(line) {
    var l = line.trim();

    /* Forma compatta ':: tipo' -> equivale a type: tipo */
    var m = l.match(/^::\s*(.+)$/);
    if (m) return { key: 'type', value: m[1].trim() };

    /* Forma commento HTML '<!-- chiave: valore -->' */
    m = l.match(/^<!--\s*([a-zA-Z]+)\s*:\s*([\s\S]*?)\s*-->$/);
    if (m) return { key: m[1].toLowerCase(), value: m[2].trim() };

    /* Forma 'chiave: valore' per le sole chiavi metadato note,
       cosi' non scambiamo per direttiva una riga KPI 'val | label'
       o un normale paragrafo che contiene ':'. */
    m = l.match(/^(type|theme|topic|note|image|img|subtitle)\s*:\s*(.*)$/i);
    if (m) return { key: m[1].toLowerCase(), value: m[2].trim() };

    return null;
  }

  /* --------------------------------------------------------
     PARSING DI UN SINGOLO BLOCCO -> modello slide
     -------------------------------------------------------- */
  function parseBlock(block, index) {
    /* Modello con tutti i campi inizializzati ai default:
       il renderer puo' sempre contare sulla loro presenza. */
    var slide = {
      type: null,        // riempito sotto; default finale 'text'
      title: '',
      subtitle: '',
      body: '',          // HTML inline gia' processato (paragrafi join con \n)
      bullets: [],       // string[] HTML inline
      kpi: [],           // [{ v: string, k: string }]
      image: '',         // path o url (stringa grezza)
      theme: null,       // riempito sotto in base a tipo/direttiva
      topic: '',         // raggruppamento colonna in modalita' landing
      note: '',          // note presentatore (non mostrate nelle slide)
      index: index       // posizione 0-based nel deck (comodita')
    };

    var lines = block.split(/\r?\n/);
    var bodyParts = [];   // paragrafi accumulati per 'body'
    var explicitTheme = null;

    for (var i = 0; i < lines.length; i++) {
      var rawLine = lines[i];
      var line = rawLine.trim();
      if (line === '') continue;

      /* 1) Direttive di metadato */
      var dir = matchDirective(rawLine);
      if (dir) {
        switch (dir.key) {
          case 'type':
            slide.type = normalizeType(dir.value);
            break;
          case 'theme':
            explicitTheme = normalizeTheme(dir.value);
            break;
          case 'topic':
            slide.topic = dir.value;
            break;
          case 'note':
            slide.note = dir.value;
            break;
          case 'subtitle':
            slide.subtitle = parseInline(dir.value);
            break;
          case 'image':
          case 'img':
            slide.image = dir.value;
            break;
        }
        continue;
      }

      /* 2) Immagine markdown ![alt](path) -> campo image */
      var img = line.match(/^!\[[^\]]*\]\(([^)]+)\)/);
      if (img) {
        slide.image = img[1].trim();
        continue;
      }

      /* 3) Sottotitolo '## ...' */
      var h2 = line.match(/^##\s+(.*)$/);
      if (h2) {
        slide.subtitle = parseInline(h2[1].trim());
        continue;
      }

      /* 4) Titolo '# ...' (primo che incontriamo vince) */
      var h1 = line.match(/^#\s+(.*)$/);
      if (h1) {
        if (!slide.title) slide.title = parseInline(h1[1].trim());
        continue;
      }

      /* 5) Citazione '> ...' -> confluisce nel body (usato da quote) */
      var quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        bodyParts.push(parseInline(quote[1].trim()));
        continue;
      }

      /* 6) Bullet '- ' oppure '* ' */
      var bullet = line.match(/^[-*]\s+(.*)$/);
      if (bullet) {
        slide.bullets.push(parseInline(bullet[1].trim()));
        continue;
      }

      /* 7) Riga KPI 'valore | etichetta' (almeno una pipe). */
      if (line.indexOf('|') !== -1) {
        var cells = line.split('|');
        var v = cells.shift().trim();
        var k = cells.join('|').trim(); // etichetta puo' contenere altre pipe
        slide.kpi.push({ v: parseInline(v), k: parseInline(k) });
        continue;
      }

      /* 8) Qualsiasi altra riga = paragrafo di corpo. */
      bodyParts.push(parseInline(line));
    }

    /* Corpo: paragrafi separati da newline (il renderer li
       spezza su \n in <p> distinti). */
    slide.body = bodyParts.join('\n');

    /* Fallback del tipo: se non dichiarato, inferiamo dal contenuto. */
    if (!slide.type) {
      if (slide.kpi.length) slide.type = 'kpi';
      else if (slide.bullets.length) slide.type = 'bullets';
      else if (slide.image && !slide.title && !slide.body) slide.type = 'image';
      else if (slide.image && (slide.title || slide.body)) slide.type = 'split';
      else slide.type = 'text';
    }

    /* Tema finale: direttiva esplicita > default del tipo > 'light'. */
    slide.theme =
      explicitTheme ||
      DEFAULT_THEME_BY_TYPE[slide.type] ||
      'light';

    return slide;
  }

  /* --------------------------------------------------------
     PARSE PRINCIPALE
     Divide il markdown in blocchi sulle righe '---' (un trattino
     a inizio riga, eventuale spazio) e converte ogni blocco.
     Ritorna SEMPRE un array (vuoto se input vuoto/nullo).
     -------------------------------------------------------- */
  function parse(markdown) {
    if (markdown == null) return [];
    var text = String(markdown).replace(/\r\n/g, '\n');

    /* Separatore slide: riga composta solo da 3+ trattini.
       Usiamo \n---\n per non confondere un '---' interno. */
    var rawBlocks = text.split(/\n[ \t]*-{3,}[ \t]*(?=\n|$)/);

    var slides = [];
    var slideIndex = 0;
    for (var i = 0; i < rawBlocks.length; i++) {
      var block = rawBlocks[i];
      if (block.trim() === '') continue; // ignora blocchi vuoti
      slides.push(parseBlock(block, slideIndex));
      slideIndex++;
    }
    return slides;
  }

  /* --------------------------------------------------------
     ESPORTAZIONE SUL NAMESPACE
     -------------------------------------------------------- */
  OFG.parse = parse;
  OFG.parseInline = parseInline;
  OFG.escapeHtml = escapeHtml;
  OFG.SLIDE_TYPES = SLIDE_TYPES.slice();
  OFG.THEMES = THEMES.slice();
  OFG.DEFAULT_THEME_BY_TYPE = DEFAULT_THEME_BY_TYPE;
})(typeof window !== 'undefined' ? window : this);
