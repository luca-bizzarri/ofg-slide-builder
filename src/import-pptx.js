/*
 * import-pptx.js — importazione di file PowerPoint (.pptx) lato browser.
 *
 * Espone:
 *   OFG.importPptx(file) -> Promise<{
 *     markdown: string,      // markdown nel formato dell'app (vedi SPEC.md)
 *     slideCount: number,    // numero di slide effettivamente importate
 *     imageCount: number,    // numero di immagini estratte e registrate
 *     warnings: string[]     // elementi non importati / segnalazioni
 *   }>
 *
 * Strategia:
 *   - Il .pptx e' uno ZIP (Open Packaging Conventions). Lo si apre con JSZip.
 *   - Le slide sono in ppt/slides/slideN.xml (ordinate NUMERICAMENTE).
 *   - Il testo sta nei nodi <a:t>, raggruppati per paragrafo <a:p> e shape <p:sp>.
 *   - Il titolo si riconosce dal placeholder <p:ph type="title"|"ctrTitle">.
 *   - Le immagini si risolvono via ppt/slides/_rels/slideN.xml.rels -> ppt/media/*.
 *
 * Nessuna dipendenza oltre a window.JSZip e window.OFG.images.addDataUri.
 */
(function (global) {
  'use strict';

  var OFG = (global.OFG = global.OFG || {});

  /* ------------------------------------------------------------------ *
   * Utility generiche
   * ------------------------------------------------------------------ */

  /* Pulisce una stringa: normalizza spazi e taglia ai bordi. */
  function cleanText(s) {
    if (!s) return '';
    // I tab/newline interni di un singolo run vanno trattati come spazi.
    return s.replace(/[\t\r\n]+/g, ' ').replace(/[  ]{2,}/g, ' ').trim();
  }

  /* Collassa righe vuote multiple in un blocco di testo. */
  function collapseBlankLines(s) {
    return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  /* Ordinamento numerico dei nomi slideN.xml (slide2 < slide10). */
  function slideNumber(path) {
    var m = /slide(\d+)\.xml$/i.exec(path);
    return m ? parseInt(m[1], 10) : 0;
  }

  /* Mime-type da estensione del media. */
  function mimeFromExt(name) {
    var ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1];
    switch ((ext || '').toLowerCase()) {
      case 'png':  return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'gif':  return 'image/gif';
      case 'webp': return 'image/webp';
      case 'bmp':  return 'image/bmp';
      case 'svg':  return 'image/svg+xml';
      case 'tiff':
      case 'tif':  return 'image/tiff';
      default:     return null; // formato non supportato / ignoto
    }
  }

  /* Conta le "parole" di una stringa (per euristiche di lunghezza). */
  function wordCount(s) {
    s = cleanText(s);
    return s ? s.split(/\s+/).length : 0;
  }

  /* ------------------------------------------------------------------ *
   * Parsing XML
   * ------------------------------------------------------------------ */

  /*
   * Parser DOM del browser. I file .pptx usano namespace (a:, p:, r:).
   * getElementsByTagName con il prefisso completo funziona in modo affidabile
   * su tutti i browser (a differenza di getElementsByTagNameNS, piu' ostico
   * coi default namespace). Usiamo quindi i tag con prefisso letterale.
   */
  function parseXml(xmlString) {
    var doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    // Un <parsererror> nel documento indica XML malformato.
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('XML non valido');
    }
    return doc;
  }

  /* Ritorna gli elementi con un dato tag (con prefisso namespace incluso). */
  function tags(node, name) {
    return node.getElementsByTagName(name);
  }

  /*
   * Estrae il testo di un paragrafo <a:p>: concatena tutti i run <a:t>.
   * I <a:br> (interruzioni di riga manuali) diventano spazi: nel nostro
   * modello un paragrafo e' una singola riga logica.
   */
  function paragraphText(pNode) {
    var ts = tags(pNode, 'a:t');
    var out = '';
    for (var i = 0; i < ts.length; i++) {
      out += ts[i].textContent || '';
    }
    return cleanText(out);
  }

  /*
   * Determina se una shape <p:sp> e' un placeholder titolo.
   * Cerca <p:nvSpPr><p:nvPr><p:ph type="title"|"ctrTitle"|"subTitle">.
   */
  function placeholderType(spNode) {
    var phs = tags(spNode, 'p:ph');
    if (!phs.length) return null;
    return phs[0].getAttribute('type') || 'body'; // ph senza type = body
  }

  /*
   * Estrae il contenuto testuale di una shape: lista di paragrafi non vuoti.
   */
  function shapeParagraphs(spNode) {
    // I paragrafi del testo della shape stanno dentro <p:txBody>.
    var txBodies = tags(spNode, 'p:txBody');
    if (!txBodies.length) return [];
    var paras = tags(txBodies[0], 'a:p');
    var out = [];
    for (var i = 0; i < paras.length; i++) {
      var t = paragraphText(paras[i]);
      if (t) out.push(t);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Relazioni / immagini
   * ------------------------------------------------------------------ */

  /*
   * Legge il file .rels di una slide e ritorna una mappa rId -> target.
   * I target immagine puntano tipicamente a "../media/imageN.ext".
   */
  function parseRels(relsXml) {
    var map = {};
    if (!relsXml) return map;
    var doc;
    try { doc = parseXml(relsXml); } catch (e) { return map; }
    var rels = tags(doc, 'Relationship');
    for (var i = 0; i < rels.length; i++) {
      var id = rels[i].getAttribute('Id');
      var target = rels[i].getAttribute('Target');
      if (id && target) map[id] = target;
    }
    return map;
  }

  /* Normalizza un target relativo (../media/x.png) in path assoluto nello zip. */
  function resolveMediaPath(target) {
    // I target sono relativi a ppt/slides/. Rimuoviamo i ../ risalendo.
    var base = 'ppt/slides/'.split('/').filter(Boolean); // ['ppt','slides']
    var parts = target.split('/');
    var stack = base.slice();
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '' || p === '.') continue;
      if (p === '..') stack.pop();
      else stack.push(p);
    }
    return stack.join('/');
  }

  /*
   * Trova i riferimenti immagine (rId) usati in una slide: <a:blip r:embed>.
   * Ritorna gli rId in ordine di apparizione.
   */
  function slideImageRefs(slideDoc) {
    var blips = tags(slideDoc, 'a:blip');
    var ids = [];
    for (var i = 0; i < blips.length; i++) {
      // L'attributo namespaced puo' essere "r:embed" o "r:link".
      var embed = blips[i].getAttribute('r:embed') || blips[i].getAttribute('r:link');
      if (embed) ids.push(embed);
    }
    return ids;
  }

  /* ------------------------------------------------------------------ *
   * Rilevamento di elementi non importabili (per i warnings)
   * ------------------------------------------------------------------ */

  function detectUnsupported(slideDoc, slideLabel, warnings) {
    var checks = [
      { tag: 'p:graphicFrame', chart: 'http://schemas.openxmlformats.org/drawingml/2006/chart' }
    ];
    // Grafici e tabelle vivono dentro <p:graphicFrame><a:graphic><a:graphicData uri="...">.
    var gd = tags(slideDoc, 'a:graphicData');
    for (var i = 0; i < gd.length; i++) {
      var uri = gd[i].getAttribute('uri') || '';
      if (/\/chart$/.test(uri)) {
        warnings.push(slideLabel + ': grafico non importato (solo i grafici nativi PPT).');
      } else if (/\/table$/.test(uri)) {
        warnings.push(slideLabel + ': tabella non importata.');
      } else if (/diagram/.test(uri)) {
        warnings.push(slideLabel + ': SmartArt/diagramma non importato.');
      }
    }
    // Video / audio embeddati.
    if (tags(slideDoc, 'p:video').length || tags(slideDoc, 'a:videoFile').length) {
      warnings.push(slideLabel + ': video non importato.');
    }
    if (tags(slideDoc, 'a:audioFile').length) {
      warnings.push(slideLabel + ': audio non importato.');
    }
  }

  /* ------------------------------------------------------------------ *
   * Costruzione del modello intermedio di una slide
   * ------------------------------------------------------------------ */

  /*
   * Analizza un documento slide e produce un oggetto:
   *   { title, body[], bullets[], imageIds[] }
   * dove body sono paragrafi "lunghi" e bullets sono voci di elenco.
   */
  function buildSlideModel(slideDoc, imageIds) {
    var sps = tags(slideDoc, 'p:sp');
    var title = '';
    var paragraphs = []; // tutti i paragrafi non-titolo, in ordine

    for (var i = 0; i < sps.length; i++) {
      var sp = sps[i];
      var ph = placeholderType(sp);
      var paras = shapeParagraphs(sp);
      if (!paras.length) continue;

      if ((ph === 'title' || ph === 'ctrTitle') && !title) {
        // Il titolo e' la prima riga del placeholder titolo; eventuali altre
        // righe del titolo vengono unite (raro).
        title = paras.join(' ');
      } else {
        // Tutto il resto (subTitle, body, shape libere) confluisce nei paragrafi.
        for (var j = 0; j < paras.length; j++) paragraphs.push(paras[j]);
      }
    }

    return {
      title: title,
      paragraphs: paragraphs,
      imageIds: imageIds || []
    };
  }

  /* ------------------------------------------------------------------ *
   * Euristica del tipo di slide + emissione markdown
   * ------------------------------------------------------------------ */

  /*
   * Decide il tipo (:: ...) di una slide e ritorna il blocco markdown.
   * ctx: { isFirst, isLast }
   */
  function slideToMarkdown(model, ctx) {
    var title = cleanText(model.title);
    var paras = model.paragraphs.map(cleanText).filter(Boolean);
    var imgs = model.imageIds || [];
    var hasImg = imgs.length > 0;

    // Regex per riconoscere blocchi che "sembrano" elenchi: piu' paragrafi
    // brevi tipicamente sono bullet. Un singolo paragrafo lungo e' body.
    var lines = [];

    /* Selezione del tipo. */
    var type = chooseType(title, paras, hasImg, ctx);

    lines.push(':: ' + type);
    if (title) lines.push('# ' + title);

    switch (type) {
      case 'cover':
      case 'section':
      case 'closing':
        // Eventuale sottotitolo: il primo paragrafo breve diventa ##.
        if (paras.length) lines.push('## ' + paras[0]);
        // Eventuali ulteriori paragrafi come testo (raro su queste slide).
        for (var c = 1; c < paras.length; c++) lines.push(paras[c]);
        break;

      case 'quote':
        // La citazione e' il paragrafo piu' lungo; l'eventuale attribuzione
        // (paragrafo che inizia con — / - o breve) va come sottotitolo.
        var q = pickQuote(paras);
        lines.push('> ' + q.quote);
        if (q.attrib) lines.push('## ' + q.attrib);
        break;

      case 'image':
        // Solo immagini (+ eventuale titolo gia' messo).
        for (var ii = 0; ii < imgs.length; ii++) lines.push('![](img:' + imgs[ii] + ')');
        // Un eventuale brevissimo testo lo teniamo come sottotitolo/caption.
        if (paras.length && wordCount(paras.join(' ')) <= 12) lines.push('## ' + paras.join(' '));
        break;

      case 'split':
        // Testo a sinistra, foto a destra: prima il testo, poi UNA immagine.
        emitBody(lines, paras);
        lines.push('![](img:' + imgs[0] + ')');
        break;

      case 'bullets':
        emitBody(lines, paras, /*forceBullets*/ true);
        break;

      case 'text':
      default:
        emitBody(lines, paras);
        if (hasImg) {
          // Testo + immagine ma non classificato split: aggiungiamo comunque la foto.
          lines.push('![](img:' + imgs[0] + ')');
        }
        break;
    }

    return lines.join('\n');
  }

  /*
   * Sceglie il tipo di slide in base a euristiche (vedi consegna).
   */
  function chooseType(title, paras, hasImg, ctx) {
    var bodyWords = wordCount(paras.join(' '));
    var nParas = paras.length;

    // 1) Citazione: nessun titolo, un solo paragrafo lungo (o virgolette).
    if (!title && nParas === 1 && (bodyWords >= 6 || /^[\"“«]/.test(paras[0]))) {
      return 'quote';
    }

    // 2) Cover: prima slide, titolo presente, poco corpo, niente elenco.
    if (ctx.isFirst && title && bodyWords <= 25 && nParas <= 2) {
      return 'cover';
    }

    // 3) Closing: ultima slide con titolo "grazie/contatti" o pochissimo testo.
    if (ctx.isLast && title && (isClosingText(title) || (bodyWords <= 15 && nParas <= 2 && !hasImg))) {
      return 'closing';
    }

    // 4) Solo immagine (nessun testo o testo minimo).
    if (hasImg && !title && bodyWords <= 3) {
      return 'image';
    }

    // 5) Section/divider: solo titolo breve, nessun corpo, nessuna immagine.
    if (title && nParas === 0 && !hasImg && wordCount(title) <= 6) {
      return 'section';
    }

    // 6) Split: titolo/testo + immagine.
    if (hasImg && (title || nParas > 0)) {
      // Se il testo e' nullo -> image, altrimenti split.
      return bodyWords === 0 ? 'image' : 'split';
    }

    // 7) Bullets: piu' paragrafi (elenco) e ognuno relativamente breve.
    if (nParas >= 2 && looksLikeList(paras)) {
      return 'bullets';
    }

    // 8) Default: testo.
    return 'text';
  }

  /* Riconosce testo da slide di chiusura. */
  function isClosingText(s) {
    return /grazie|thank|contatt|contact|domande|questions|q\s*&\s*a/i.test(s);
  }

  /*
   * Un insieme di paragrafi "sembra un elenco" se la maggior parte sono brevi.
   * Soglia: media parole per paragrafo <= 14 e nessun paragrafo enorme.
   */
  function looksLikeList(paras) {
    if (paras.length < 2) return false;
    var maxW = 0, totW = 0;
    for (var i = 0; i < paras.length; i++) {
      var w = wordCount(paras[i]);
      totW += w;
      if (w > maxW) maxW = w;
    }
    var avg = totW / paras.length;
    return avg <= 16 && maxW <= 30;
  }

  /*
   * Emette i paragrafi come body (paragrafi) o come bullets.
   * - forceBullets: emette tutto come "- voce".
   * - altrimenti: se sembra elenco -> bullets, se 1 paragrafo -> body.
   */
  function emitBody(lines, paras, forceBullets) {
    if (!paras.length) return;
    var asList = forceBullets || (paras.length >= 2 && looksLikeList(paras));
    if (asList) {
      for (var i = 0; i < paras.length; i++) lines.push('- ' + paras[i]);
    } else {
      // Uno o piu' paragrafi di testo libero.
      for (var j = 0; j < paras.length; j++) lines.push(paras[j]);
    }
  }

  /*
   * Da una lista di paragrafi estrae la citazione (la riga piu' lunga) e
   * un'eventuale attribuzione (riga breve che inizia con — / - oppure "by").
   */
  function pickQuote(paras) {
    if (!paras.length) return { quote: '', attrib: '' };
    var quoteIdx = 0, maxW = -1;
    for (var i = 0; i < paras.length; i++) {
      var w = wordCount(paras[i]);
      if (w > maxW) { maxW = w; quoteIdx = i; }
    }
    var quote = paras[quoteIdx].replace(/^[\"“«]\s*/, '').replace(/[\"”»]\s*$/, '');
    var attrib = '';
    for (var j = 0; j < paras.length; j++) {
      if (j === quoteIdx) continue;
      // Prendiamo come attribuzione la prima riga "altra" (di solito una sola).
      attrib = paras[j].replace(/^[—\-–]\s*/, '');
      break;
    }
    return { quote: quote, attrib: attrib };
  }

  /* ------------------------------------------------------------------ *
   * Funzione principale
   * ------------------------------------------------------------------ */

  /*
   * Importa un file .pptx e produce il markdown dell'app.
   * @param {File|Blob} file
   * @returns {Promise<{markdown,slideCount,imageCount,warnings}>}
   */
  function importPptx(file) {
    // Verifica dipendenze il prima possibile.
    if (!global.JSZip) {
      return Promise.reject(new Error('JSZip non disponibile: impossibile leggere il .pptx.'));
    }
    if (!OFG.images || typeof OFG.images.addDataUri !== 'function') {
      return Promise.reject(new Error('OFG.images.addDataUri non disponibile: impossibile registrare le immagini.'));
    }
    if (!file) {
      return Promise.reject(new Error('Nessun file fornito a OFG.importPptx.'));
    }

    var warnings = [];
    var imageCount = 0;

    return global.JSZip.loadAsync(file).then(function (zip) {
      // 1) Raccogli e ordina numericamente i file slide.
      var slidePaths = [];
      zip.forEach(function (relPath) {
        if (/^ppt\/slides\/slide\d+\.xml$/i.test(relPath)) {
          slidePaths.push(relPath);
        }
      });

      if (!slidePaths.length) {
        throw new Error('Nessuna slide trovata: il file non sembra un .pptx valido.');
      }

      slidePaths.sort(function (a, b) { return slideNumber(a) - slideNumber(b); });

      // Cache delle immagini gia' registrate (un media usato in piu' slide
      // viene registrato una sola volta).
      var mediaIdCache = {}; // path media -> id OFG

      // 2) Per ogni slide: leggi XML, rels, registra immagini, costruisci modello.
      // Catena di Promise sequenziale per mantenere l'ordine e limitare la RAM.
      var seq = Promise.resolve();
      var models = []; // { model, label }

      slidePaths.forEach(function (slidePath, idx) {
        seq = seq.then(function () {
          var slideLabel = 'Slide ' + (idx + 1);
          return zip.file(slidePath).async('string').then(function (xml) {
            var slideDoc;
            try {
              slideDoc = parseXml(xml);
            } catch (e) {
              warnings.push(slideLabel + ': XML non leggibile, slide saltata.');
              return null;
            }

            // Segnala elementi non importabili.
            detectUnsupported(slideDoc, slideLabel, warnings);

            // Note del relatore: le ignoriamo, ma lo segnaliamo se presenti.
            var notesPath = 'ppt/notesSlides/notesSlide' + slideNumber(slidePath) + '.xml';
            if (zip.file(notesPath)) {
              warnings.push(slideLabel + ': note del relatore ignorate.');
            }

            // Risolvi le immagini della slide.
            var relsPath = 'ppt/slides/_rels/' + slidePath.split('/').pop() + '.rels';
            var relsFile = zip.file(relsPath);
            var relsPromise = relsFile ? relsFile.async('string') : Promise.resolve('');

            return relsPromise.then(function (relsXml) {
              var relMap = parseRels(relsXml);
              var refs = slideImageRefs(slideDoc);
              var imageIds = [];

              // Registra ogni immagine referenziata (in sequenza).
              var imgSeq = Promise.resolve();
              refs.forEach(function (rId) {
                imgSeq = imgSeq.then(function () {
                  var target = relMap[rId];
                  if (!target) return;
                  // Link esterni (http) non sono embeddati nello zip: skip.
                  if (/^https?:/i.test(target)) {
                    warnings.push(slideLabel + ': immagine collegata esterna non importata.');
                    return;
                  }
                  var mediaPath = resolveMediaPath(target);
                  // Gia' registrata?
                  if (mediaIdCache[mediaPath]) {
                    imageIds.push(mediaIdCache[mediaPath]);
                    return;
                  }
                  var mediaFile = zip.file(mediaPath);
                  if (!mediaFile) {
                    warnings.push(slideLabel + ': media "' + mediaPath + '" mancante nel pacchetto.');
                    return;
                  }
                  var mime = mimeFromExt(mediaPath);
                  if (!mime || mime === 'image/tiff') {
                    warnings.push(slideLabel + ': immagine in formato non supportato (' + mediaPath + ').');
                    return;
                  }
                  return mediaFile.async('base64').then(function (b64) {
                    var dataUri = 'data:' + mime + ';base64,' + b64;
                    var id;
                    try {
                      id = OFG.images.addDataUri(dataUri, mediaPath.split('/').pop());
                    } catch (e) {
                      warnings.push(slideLabel + ': errore registrazione immagine (' + mediaPath + ').');
                      return;
                    }
                    if (id) {
                      mediaIdCache[mediaPath] = id;
                      imageIds.push(id);
                      imageCount++;
                    }
                  });
                });
              });

              return imgSeq.then(function () {
                var model = buildSlideModel(slideDoc, imageIds);
                // Slide vuota (ne' testo ne' immagini): salta con warning.
                if (!cleanText(model.title) && !model.paragraphs.length && !imageIds.length) {
                  warnings.push(slideLabel + ': vuota, saltata.');
                  return;
                }
                models.push({ model: model, label: slideLabel });
              });
            });
          });
        });
      });

      return seq.then(function () {
        // 3) Genera il markdown con le euristiche di tipo.
        var blocks = [];
        for (var i = 0; i < models.length; i++) {
          var ctx = { isFirst: i === 0, isLast: i === models.length - 1 };
          var md = slideToMarkdown(models[i].model, ctx);
          if (md) blocks.push(collapseBlankLines(md));
        }

        var markdown = blocks.join('\n\n---\n\n');

        return {
          markdown: markdown,
          slideCount: models.length,
          imageCount: imageCount,
          warnings: warnings
        };
      });
    }).catch(function (err) {
      // Rilancia con messaggio chiaro mantenendo la causa.
      var msg = (err && err.message) ? err.message : String(err);
      throw new Error('Importazione .pptx fallita: ' + msg);
    });
  }

  /* Esporta sul namespace condiviso. */
  OFG.importPptx = importPptx;

})(typeof window !== 'undefined' ? window : this);
