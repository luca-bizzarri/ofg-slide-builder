# OFG Slide Builder — SPEC tecnica

App 100% client-side (vanilla JS, nessun framework, nessuno step di build).
Funziona aprendo `index.html` da disco e su GitHub Pages (path relativi).
Brand: **nero `#000`**, **bianco `#fff`**, **giallo `#ffff00`**. Font: **Raleway** (`.ttf` locali).

Questo documento e' il **contratto stabile** tra i moduli. `parser.js`,
`design-tokens.css` e `fonts.css` sono gia' implementati e fissano lo schema.
`renderer.js`, `engine.js`, `editor.js`, `export.js` lo implementano.

---

## 1. Architettura e flusso dati

```
markdown (string)
   │  OFG.parse()                        parser.js
   ▼
Slide[] (modello JSON)
   │  OFG.renderDeck() / OFG.renderSlide()   renderer.js
   ▼
DOM (sezioni .slide dentro un contenitore)
   │  OFG.Engine(container, mode)         engine.js
   ▼
navigazione deck (orizzontale) / landing (2D)
```

- `editor.js` orchestra: legge la textarea -> `OFG.parse` -> `OFG.renderDeck`
  -> (ri)crea l'`OFG.Engine`, gestisce toggle modalita'/tema ed export.
- `export.js` produce un singolo `.html` autonomo (CSS + JS inline, asset come
  `data:` URI) senza l'interfaccia editor.
- Tutti i moduli condividono il namespace globale **`window.OFG`**.

---

## 2. Schema del modello Slide

`OFG.parse()` ritorna un **array** di oggetti con questa forma **esatta**.
Tutti i campi sono SEMPRE presenti (il parser inizializza i default), quindi il
renderer non deve mai controllare `undefined`.

```js
/**
 * @typedef {Object} Slide
 * @property {string}  type     Uno di OFG.SLIDE_TYPES. Default 'text'.
 * @property {string}  title    HTML inline gia' sanitizzato. '' se assente.
 * @property {string}  subtitle HTML inline. '' se assente.
 * @property {string}  body     HTML inline; paragrafi separati da '\n'. '' se assente.
 * @property {string[]} bullets Array di stringhe HTML inline. [] se assente.
 * @property {Array<{v:string,k:string}>} kpi  v=valore, k=etichetta (HTML inline). [] se assente.
 * @property {string}  image    Path locale o URL grezzo (NON sanitizzato come HTML). '' se assente.
 * @property {'light'|'dark'} theme  Tema risolto (mai null nell'output).
 * @property {string}  topic    Chiave di raggruppamento per la modalita' landing. '' se assente.
 * @property {string}  note     Note presentatore (non rese nelle slide). '' se assente.
 * @property {number}  index    Posizione 0-based nel deck.
 */
```

### Note sui campi
- **`title/subtitle/body/bullets/kpi`**: gia' passati per `parseInline`, quindi
  contengono HTML **sicuro** (`<strong> <em> <code> <mark> <a>`). Il renderer li
  inserisce via `innerHTML` senza ulteriore escape.
- **`body`**: il renderer spezza su `\n` per generare piu' `<p>`.
- **`image`**: stringa grezza (path/URL). Il renderer la usa in `src` e deve
  gestire il caso vuoto col placeholder geometrico.
- **`theme`**: gia' risolto (esplicito > default-per-tipo > `light`).
- **`topic`**: slide con lo stesso `topic` formano una **colonna** in landing.

---

## 3. Formato markdown di input

- **Una slide per blocco**, blocchi separati da una riga `---` (3+ trattini).
- **Tipo** dichiarato nel blocco con UNA direttiva:
  - forma compatta: `:: cover`
  - forma commento: `<!-- type: cover -->`
  - forma chiave: `type: cover`
- Se il tipo non e' dichiarato viene **inferito** dal contenuto (kpi -> `kpi`,
  bullet -> `bullets`, solo immagine -> `image`, immagine+testo -> `split`,
  altrimenti -> `text`).

### Sintassi riconosciuta nel blocco
| Elemento            | Sintassi                                  | Campo modello        |
|---------------------|-------------------------------------------|----------------------|
| Tipo                | `:: tipo` / `<!-- type: tipo -->` / `type: tipo` | `type`        |
| Titolo              | `# Titolo`                                | `title` (primo vince)|
| Sottotitolo         | `## Sottotitolo` o `subtitle: ...`        | `subtitle`           |
| Paragrafo           | riga di testo libera                      | `body` (join `\n`)   |
| Citazione           | `> testo`                                 | `body`               |
| Bullet              | `- voce` o `* voce`                       | `bullets[]`          |
| KPI                 | `valore \| etichetta`                     | `kpi[] {v,k}`        |
| Immagine            | `![](path)` o `image: path`               | `image`              |
| Tema                | `theme: dark` / `theme: light`            | `theme`              |
| Topic (landing)     | `topic: NomeColonna`                      | `topic`              |
| Note presentatore   | `note: ...`                               | `note`               |

### Formattazione inline (in titoli, testi, bullet, kpi)
`**grassetto**`, `*corsivo*`, `` `code` ``, `==evidenziato==` (accento giallo),
`[testo](url)` (solo url `http(s)`, `/`, `./`, `#`, `mailto:`).

### Alias di tipo accettati
`title|copertina`→cover, `divider|categoria`→section, `paragrafo`→text,
`list|elenco`→bullets, `stats|numbers`→kpi, `citazione`→quote,
`foto|photo|immagine`→image, `duo`→split, `end|chiusura`→closing.
Alias tema: `nero/scuro/black`→dark, `bianco/chiaro`→light.

### Esempio per OGNI tipo di slide

```markdown
:: cover
# IL FUTURO DELL'ENERGIA
## Report annuale 2026
note: respira prima di iniziare

---

:: section
topic: Risultati
# 01 — RISULTATI

---

:: text
topic: Risultati
# La nostra visione
Costruiamo soluzioni **on-brand** per il mercato dell'energia.
Secondo paragrafo con un ==concetto chiave== evidenziato.

---

:: bullets
topic: Risultati
# Punti di forza
- Crescita ==a doppia cifra==
- Presenza in *12 regioni*
- Team da **120 persone**

---

:: kpi
topic: Risultati
theme: dark
# I numeri del 2026
+38% | crescita ricavi
12 | nuovi mercati
98% | retention clienti

---

:: quote
topic: Vision
> L'energia migliore e' quella che non sprechiamo.
## — Direzione OFG

---

:: image
topic: Vision
![](./assets/sample-photo.jpg)
# Impianto di Brindisi

---

:: split
topic: Vision
# Tecnologia e persone
Il nostro impianto unisce automazione e competenza umana.
![](./assets/sample-photo.jpg)

---

:: closing
# GRAZIE
## ofg.it · luca.bizzarri@ofg.it
```

---

## 4. API dei moduli

### 4.1 `parser.js` (IMPLEMENTATO — contratto fisso)
```js
window.OFG.parse(markdown: string) : Slide[]      // mai lancia, mai null
window.OFG.parseInline(text: string) : string     // HTML inline sicuro
window.OFG.escapeHtml(text: string) : string
window.OFG.SLIDE_TYPES : string[]                  // ['cover','section',...]
window.OFG.THEMES : string[]                       // ['light','dark']
window.OFG.DEFAULT_THEME_BY_TYPE : Record<string,'light'|'dark'>
```

### 4.2 `renderer.js` (da implementare)
Trasforma il modello in DOM. Una funzione di rendering per tipo internamente,
ma l'API pubblica e' minimale:
```js
/**
 * Crea l'elemento DOM di UNA slide.
 * @param {Slide} slide
 * @returns {HTMLElement}  <section class="slide slide--TYPE theme-THEME" ...>
 */
window.OFG.renderSlide(slide) : HTMLElement

/**
 * Renderizza l'intero deck dentro un contenitore.
 * Svuota il contenitore, crea le slide, imposta i data-attribute
 * necessari all'engine (vedi sotto) e ritorna i modelli usati.
 * @param {HTMLElement} container
 * @param {Slide[]} slides
 * @param {{mode?: 'deck'|'landing'}} [opts]
 * @returns {Slide[]}
 */
window.OFG.renderDeck(container, slides, opts) : Slide[]

/**
 * (Opzionale) HTML stringa di una slide, per l'export statico.
 * @returns {string}
 */
window.OFG.renderSlideHTML(slide) : string
```

**Contratto DOM che il renderer DEVE produrre** (l'engine vi si appoggia):
- Ogni slide e' un `<section class="slide slide--{type} theme-{theme}">`.
- Attributi: `data-type`, `data-theme`, `data-topic` (vuoto se assente),
  `data-index`, `id="slide-{index}"`, `tabindex="-1"` (focusabile via JS).
- Variabili tema impostate inline sulla section:
  `style="--bg:…; --fg:…; --accent:…"` coerenti col tema (light/dark).
- Gli elementi da animare in ingresso portano la classe **`.reveal`** e una
  custom property **`--i`** (indice 0-based per lo stagger).
- La barretta gialla sotto gli H2 e' l'elemento `.bar` (o `::after` su `.h2`):
  in stato iniziale ha `transform: scaleX(0)`, l'engine aggiunge `.is-visible`.

### 4.3 `engine.js` (da implementare)
```js
/**
 * @param {HTMLElement} container  contenitore con le slide gia' renderizzate
 * @param {{
 *   mode?: 'deck'|'landing',     // default 'deck'
 *   start?: number,              // indice slide iniziale
 *   onChange?: (state) => void   // callback ad ogni cambio slide
 * }} [options]
 */
window.OFG.Engine = function (container, options) { ... }

// Metodi d'istanza:
engine.goTo(index)        // vai alla slide N (deck) o {col,row} (landing)
engine.next()             // slide successiva
engine.prev()             // slide precedente
engine.setMode('deck'|'landing')  // cambia modalita' (ricostruisce nav)
engine.getState()         // -> { index, col, row, total, mode, theme }
engine.destroy()          // rimuove listener/observer (per re-render pulito)
```

**Comportamenti richiesti:**
- **deck**: scorrimento orizzontale; tasti ←/→, PageUp/Down, Space; dots nav
  (pallino attivo giallo allungato); bottoni prev/next; deep-link via
  `location.hash` (`#slide-3`). Base: `scroll-snap-type: x mandatory` +
  `scroll-snap-align: start` + `scroll-snap-stop: always`.
- **landing**: griglia 2D. Ogni `topic` = **colonna**; scroll **verticale** =
  slide dello stesso topic; scroll **orizzontale** = cambio topic. Scroll-snap
  2D annidato; indicatore posizione 2D (riga+colonna).
- **Tema dinamico**: al cambio slide aggiorna `--bg/--fg/--accent` (via
  `IntersectionObserver` threshold ~0.6) con transizione `--dur-theme`.
- **Reveal**: `IntersectionObserver` (threshold ~0.15) aggiunge `.is-visible`
  agli elementi `.reveal`; `unobserve` dopo il primo trigger.
- **Accessibilita'**: rispetta `prefers-reduced-motion`; slide focusabili;
  fallback a colonna singola su mobile.

### 4.4 `editor.js` (da implementare)
Orchestra UI. Pipeline: `input` (debounce ~200ms, flush sui caratteri-confine)
-> `OFG.parse` -> `OFG.renderDeck` -> ricrea `OFG.Engine`. Gestisce: upload `.md`,
toggle modalita' deck/landing, toggle tema globale, autosave `localStorage`,
indicatore stato, bottone export -> `OFG.exportHTML`.

### 4.5 `export.js` (da implementare)
```js
/**
 * Genera la stringa HTML di un file autonomo (CSS+JS inline, asset data: URI),
 * SENZA interfaccia editor, con engine di sola navigazione.
 * @param {Slide[]} slides
 * @param {{ mode?: 'deck'|'landing', title?: string }} [opts]
 * @returns {Promise<string>}  HTML completo
 */
window.OFG.exportHTML(slides, opts) : Promise<string>

window.OFG.downloadHTML(slides, opts) : Promise<void>  // avvia il download
```

---

## 5. Classi CSS condivise (contratto `slides.css`)

| Classe / selettore        | Significato                                              |
|---------------------------|----------------------------------------------------------|
| `.deck`                   | contenitore radice delle slide                           |
| `.deck--deck`             | modalita' deck (scroll orizzontale)                      |
| `.deck--landing`          | modalita' landing (griglia 2D)                           |
| `.slide`                  | singola slide full-viewport (`100dvh`)                   |
| `.slide--{type}`          | variante per tipo (cover, section, text, …)              |
| `.theme-light`/`.theme-dark` | tema della slide (imposta `--bg/--fg/--accent`)       |
| `.slide__inner`           | wrapper contenuto centrato (`max-width: --slide-max-w`)  |
| `.h2` + `.bar`            | titolo standard con barretta gialla animata sotto        |
| `.kpi-card`               | card nera arrotondata (numero `.kpi-card__v` + `.kpi-card__k`) |
| `.reveal`                 | elemento da rivelare in ingresso (+ `--i` per stagger)   |
| `.is-visible`             | stato finale del reveal (aggiunto dall'engine)           |
| `.nav-dots` / `.nav-dot`  | dots di navigazione (deck)                               |
| `.nav-dot.is-active`      | dot attivo (giallo allungato a pillola)                  |
| `.nav-arrows`             | bottoni prev/next                                        |
| `.pos-indicator`          | indicatore posizione 2D (landing)                        |
| `.media`/`.media__img`/`.media--placeholder` | wrapper immagine + placeholder geometrico |
| `.media--duotone`         | trattamento duotone nero/giallo (filter SVG)             |

**Convenzione tema via CSS variables**: i blocchi `.theme-light`/`.theme-dark`
impostano `--bg`, `--fg`, `--accent`; tutto il resto dei selettori usa SOLO
queste variabili (mai colori hardcoded oltre i 3 brand). Cosi' il cambio tema
in landing e' un semplice cross-fade delle variabili.

---

## 6. Convenzioni animazioni

- **Default = stato finale visibile.** Le animazioni sono **additive** e girano
  solo dentro `@media (prefers-reduced-motion: no-preference)`. In JS: gate con
  `matchMedia('(prefers-reduced-motion: reduce)').matches`.
- **Reveal d'ingresso**: elemento `.reveal` parte a `opacity:0; translateY(16px)`;
  `IntersectionObserver` (threshold ~0.15) aggiunge `.is-visible` -> transizione
  a `opacity:1; translateY(0)` con `--dur-reveal` e `--ease-out`. `unobserve`
  one-shot. Elementi gia' in viewport al load devono risultare subito visibili.
- **Stagger**: ai figli si assegna `--i` (0,1,2,…) e
  `transition-delay: calc(var(--i) * var(--stagger-step))`.
- **Barretta gialla draw-in**: `.bar` parte `transform: scaleX(0); transform-origin:left`;
  con `.is-visible` -> `scaleX(1)` in `--dur-reveal`.
- **Transizione slide (deck)**: snap nativo per il movimento; eventuali
  fade/scale del contenuto via `.reveal` ri-armato al cambio slide.
- **Cambio tema (landing)**: transizione di `--bg/--fg/--accent` in `--dur-theme`.
- **Durate/easing**: usare SEMPRE i token (`--dur-*`, `--ease-*`, `--stagger-step`)
  da `design-tokens.css`, mai valori magici.

---

## 7. File del progetto

| File                     | Ruolo                                                    | Stato        |
|--------------------------|----------------------------------------------------------|--------------|
| `index.html`             | shell: editor a sx + preview a dx                        | da fare      |
| `src/design-tokens.css`  | variabili colore/tipografia/spaziature/anim/z-index      | **fatto**    |
| `src/fonts.css`          | @font-face Raleway locale                                | **fatto**    |
| `src/slides.css`         | stili di tutti i tipi di slide + animazioni              | da fare      |
| `src/editor.css`         | stili interfaccia editor                                 | da fare      |
| `src/parser.js`          | markdown -> Slide[]                                      | **fatto**    |
| `src/renderer.js`        | Slide -> DOM                                             | da fare      |
| `src/engine.js`          | navigazione deck / landing 2D                           | da fare      |
| `src/editor.js`          | UI editor, preview live, toggle, export                 | da fare      |
| `src/export.js`          | HTML autonomo scaricabile                                | da fare      |
| `samples/esempio.md`     | demo con tutti i tipi di slide                          | da fare      |

---

## 8. Vincoli non negoziabili

1. **Solo 3 colori**: nero, bianco, giallo (+ grigi tecnici neutri). Il giallo e'
   un **micro-accento** (max ~5-10% di superficie), mai fondo diffuso.
2. **Path relativi** ovunque (GitHub Pages + apertura da file://).
3. **Nessun CDN/framework/build**. Parser markdown interno.
4. **`100dvh`** (non `100vh`) per le slide full-screen.
5. **Accessibilita'**: focus gestito, tastiera, `prefers-reduced-motion`,
   fallback responsive a colonna singola su mobile.
6. **Sicurezza**: ogni testo passa per `escapeHtml`/`parseInline`; le url dei
   link sono filtrate (no `javascript:`).
