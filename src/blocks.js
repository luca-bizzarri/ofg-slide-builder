/**
 * OFG.blocks — funzioni PURE per gestire il markdown delle slide.
 *
 * Modello: il markdown e' una sequenza di "blocchi" (una slide = un blocco)
 * separati da una riga di soli trattini che matcha /^\s*-{3,}\s*$/.
 *
 * Nessuna funzione tocca il DOM o ha side effect: ricevono stringhe/numeri
 * e restituiscono nuove stringhe/oggetti.
 */
(function () {
  'use strict';

  // Riusa il namespace globale senza sovrascriverlo.
  window.OFG = window.OFG || {};

  // Regex ESATTA del separatore di blocco: riga intera di soli trattini (>=3),
  // con eventuale whitespace ai lati. NON matcha i bullet "- " ne' le righe
  // di tabella "| --- |" perche' richiede che TUTTA la riga siano trattini.
  var SEP_RE = /^\s*-{3,}\s*$/;

  // Separatore canonico usato in fase di ricomposizione.
  var JOIN_SEP = '\n\n---\n\n';

  // Regex per una riga immagine markdown, con graffe opzioni opzionali.
  // Cattura: 1 = alt, 2 = ref, 3 = contenuto graffe (senza le graffe).
  // Esempi:
  //   ![](img:3)
  //   ![alt](./foto.jpg){fit:cover; pos:60,30; zoom:1.2}
  var IMG_LINE_RE = /^\s*!\[([^\]]*)\]\(([^)]*)\)\s*(?:\{([^}]*)\})?\s*$/;

  // ---------------------------------------------------------------------------
  // Helper interni (non esposti)
  // ---------------------------------------------------------------------------

  /**
   * Divide il markdown in array di righe preservando il contenuto.
   * Normalizza i fine-riga CRLF/CR in LF per un parsing coerente.
   */
  function toLines(md) {
    return String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  }

  /**
   * Parsifica la stringa di opzioni (contenuto tra graffe) in un oggetto.
   * Tollera spazi, ordine variabile, campi mancanti e valori non numerici.
   * Ritorna un oggetto con eventuali campi: {fit, posX, posY, zoom}.
   */
  function parseOpts(optStr) {
    var opts = {};
    if (!optStr) return opts;

    // Le coppie sono separate da ";". Ogni coppia e' "chiave:valore".
    var parts = optStr.split(';');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) continue;

      var idx = part.indexOf(':');
      if (idx === -1) continue;

      var key = part.slice(0, idx).trim().toLowerCase();
      var val = part.slice(idx + 1).trim();

      if (key === 'fit') {
        // Accetta solo i valori validi 'cover' | 'contain'.
        var fit = val.toLowerCase();
        if (fit === 'cover' || fit === 'contain') opts.fit = fit;
      } else if (key === 'pos') {
        // pos = "posX,posY", numeri 0-100. Ignora valori non numerici.
        var coords = val.split(',');
        var x = parseFloat(coords[0]);
        var y = parseFloat(coords[1]);
        if (isFinite(x)) opts.posX = x;
        if (isFinite(y)) opts.posY = y;
      } else if (key === 'zoom') {
        var z = parseFloat(val);
        if (isFinite(z)) opts.zoom = z;
      }
      // Chiavi sconosciute: ignorate.
    }
    return opts;
  }

  /**
   * Serializza un oggetto opzioni in stringa graffe "{...}".
   * Omette i campi non forniti o uguali ai default
   * (fit 'cover', pos 50,50, zoom 1) => non scrive quel campo.
   * Ritorna "" se non c'e' nessuna opzione significativa da scrivere.
   */
  function serializeOpts(opts) {
    opts = opts || {};
    var fields = [];

    // fit: default 'cover'. Scrive solo se valido e diverso dal default.
    if (opts.fit === 'contain') {
      fields.push('fit:contain');
    } else if (opts.fit === 'cover') {
      // default: non scrivere.
    }

    // pos: default 50,50. Scrive solo se almeno una coord differisce dal default.
    var hasX = isFinite(opts.posX);
    var hasY = isFinite(opts.posY);
    if (hasX || hasY) {
      var px = hasX ? opts.posX : 50;
      var py = hasY ? opts.posY : 50;
      if (px !== 50 || py !== 50) {
        fields.push('pos:' + px + ',' + py);
      }
    }

    // zoom: default 1. Scrive solo se diverso da 1.
    if (isFinite(opts.zoom) && opts.zoom !== 1) {
      fields.push('zoom:' + opts.zoom);
    }

    if (!fields.length) return '';
    return '{' + fields.join('; ') + '}';
  }

  /**
   * Trova l'indice della prima riga immagine in un array di righe.
   * Ritorna -1 se non presente.
   */
  function findImageLineIndex(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (IMG_LINE_RE.test(lines[i])) return i;
    }
    return -1;
  }

  /**
   * Compone la riga immagine a partire da ref e (opzionale) stringa graffe.
   */
  function buildImageLine(ref, optStr) {
    var line = '![](' + ref + ')';
    if (optStr) line += optStr;
    return line;
  }

  // ---------------------------------------------------------------------------
  // API pubblica
  // ---------------------------------------------------------------------------

  /**
   * Divide il markdown in blocchi. Ogni blocco e' il testo tra due separatori.
   * Il contenuto interno (newline inclusi) viene preservato; vengono rimossi
   * solo i fine-riga marginali (trim) attorno ai separatori.
   */
  function split(md) {
    var lines = toLines(md);
    var blocks = [];
    var current = [];

    for (var i = 0; i < lines.length; i++) {
      if (SEP_RE.test(lines[i])) {
        blocks.push(current.join('\n'));
        current = [];
      } else {
        current.push(lines[i]);
      }
    }
    blocks.push(current.join('\n'));

    // Trim marginale: rimuove whitespace ai bordi di ogni blocco, mantenendo
    // intatto il contenuto interno (incluse le righe vuote in mezzo).
    return blocks.map(function (b) {
      return b.replace(/^\s+|\s+$/g, '');
    });
  }

  /**
   * Ricompone i blocchi con il separatore canonico "\n\n---\n\n".
   */
  function join(blocks) {
    if (!Array.isArray(blocks)) return '';
    return blocks.join(JOIN_SEP);
  }

  /**
   * Numero di blocchi NON vuoti.
   */
  function count(md) {
    return split(md).filter(function (b) {
      return b.trim() !== '';
    }).length;
  }

  /**
   * Sposta il blocco da fromIndex a toIndex e ricompone.
   * Indici fuori range: ritorna md invariato.
   */
  function reorder(md, fromIndex, toIndex) {
    var blocks = split(md);
    var n = blocks.length;

    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 || fromIndex >= n ||
      toIndex < 0 || toIndex >= n
    ) {
      return md;
    }

    if (fromIndex === toIndex) return join(blocks);

    var moved = blocks.splice(fromIndex, 1)[0];
    blocks.splice(toIndex, 0, moved);
    return join(blocks);
  }

  /**
   * Legge la prima immagine del blocco `index`.
   * Ritorna { ref, alt, opts } oppure null se non c'e' immagine / index invalido.
   */
  function getImage(md, index) {
    var blocks = split(md);
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length) {
      return null;
    }

    var lines = blocks[index].split('\n');
    var li = findImageLineIndex(lines);
    if (li === -1) return null;

    var m = lines[li].match(IMG_LINE_RE);
    return {
      ref: m[2],
      alt: m[1] || '',
      opts: parseOpts(m[3])
    };
  }

  /**
   * Imposta/sostituisce la riga immagine del blocco `index` con "![](ref)".
   * - Se ref e' "" o null => RIMUOVE la riga immagine.
   * - Se il blocco non aveva immagine => aggiunge la riga in fondo al blocco.
   * - setImage AZZERA sempre le opzioni (non preserva le graffe esistenti).
   * Index fuori range: ritorna md invariato.
   */
  function setImage(md, index, ref) {
    var blocks = split(md);
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length) {
      return md;
    }

    var lines = blocks[index].split('\n');
    var li = findImageLineIndex(lines);
    var remove = (ref == null || ref === '');

    if (li !== -1) {
      if (remove) {
        // Rimuove la riga immagine esistente.
        lines.splice(li, 1);
      } else {
        // Sostituisce azzerando le opzioni.
        lines[li] = buildImageLine(ref, '');
      }
    } else if (!remove) {
      // Nessuna immagine: aggiunge in fondo al blocco.
      // Evita righe vuote spurie se il blocco e' vuoto.
      if (lines.length === 1 && lines[0] === '') {
        lines[0] = buildImageLine(ref, '');
      } else {
        lines.push(buildImageLine(ref, ''));
      }
    }

    blocks[index] = lines.join('\n');
    return join(blocks);
  }

  /**
   * Aggiorna SOLO le graffe di opzioni sulla riga immagine esistente del blocco.
   * opts = {fit, posX, posY, zoom} (tutti opzionali). Preserva ref e alt.
   * Se non c'e' immagine nel blocco => ritorna md invariato.
   */
  function setImageOpts(md, index, opts) {
    var blocks = split(md);
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length) {
      return md;
    }

    var lines = blocks[index].split('\n');
    var li = findImageLineIndex(lines);
    if (li === -1) return md;

    var m = lines[li].match(IMG_LINE_RE);
    var alt = m[1] || '';
    var ref = m[2];

    var optStr = serializeOpts(opts);
    var line = '![' + alt + '](' + ref + ')';
    if (optStr) line += optStr;

    lines[li] = line;
    blocks[index] = lines.join('\n');
    return join(blocks);
  }

  // Espone l'API pubblica.
  window.OFG.blocks = {
    split: split,
    join: join,
    count: count,
    reorder: reorder,
    getImage: getImage,
    setImage: setImage,
    setImageOpts: setImageOpts
  };
})();
