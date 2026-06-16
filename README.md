# OFG Slide Builder

Editor di presentazioni **100% client-side** (vanilla JS, nessun framework, nessuno
step di build). Scrivi **markdown** a sinistra, guardi l'**anteprima live** della
presentazione a destra, ed esporti un singolo file `.html` autonomo.

Tutto on-brand OFG: solo **nero `#000`**, **bianco `#fff`**, **giallo `#ffff00`**,
font **Raleway** (`.ttf` locali). Funziona aprendo `index.html` da disco e su
**GitHub Pages** (tutti i path sono relativi).

---

## Cosa fa

- Converte un documento markdown in una presentazione navigabile.
- Due modalita' di navigazione:
  - **Deck**: scorrimento orizzontale classico (frecce, dots, tastiera, deep-link `#slide-N`).
  - **Landing**: griglia 2D stile fullPage — ogni `topic` e' una **colonna**, lo
    scroll verticale approfondisce dentro il topic, l'orizzontale cambia topic.
- 9 tipi di slide: `cover`, `section`, `text`, `bullets`, `kpi`, `quote`, `image`,
  `split`, `closing`.
- Microanimazioni d'ingresso (reveal con stagger, draw-in della barretta gialla),
  con pieno rispetto di `prefers-reduced-motion`.
- Trattamento foto on-brand (placeholder geometrico elegante se l'immagine manca).
- Export di un file HTML autonomo (CSS + JS inline) pronto per la condivisione.

---

## Come si usa l'editor

1. Apri **`index.html`** (doppio click, oppure servilo via GitHub Pages / un
   qualunque web server statico).
2. Scrivi il markdown nel pannello di sinistra: l'anteprima a destra si aggiorna
   in tempo reale. All'avvio viene caricato `samples/esempio.md` come demo.
3. Usa la toolbar in alto per:
   - **Carica .md** — importa un file markdown (anche via drag & drop sul pannello sorgente).
   - **Modalita'** — passa tra `Deck` e `Landing`.
   - **Tema** — `Auto` (rispetta il tema di ogni slide), `Chiaro` o `Scuro` (forza tutte).
   - **Esporta HTML** — scarica la presentazione come file autonomo.
4. Navigazione in anteprima: frecce `←/→`, `PageUp/PageDown`, `Spazio`, `Home/End`;
   click su dots/frecce. In landing: `←/→` cambia topic, `↑/↓` scorre dentro il topic.

Il sorgente viene salvato automaticamente in `localStorage`, quindi al riavvio
ritrovi il tuo lavoro.

---

## Formato markdown di input (riassunto)

- **Una slide per blocco**, blocchi separati da una riga `---` (3+ trattini).
- **Tipo** dichiarato con una direttiva: `:: cover` oppure `<!-- type: cover -->`
  oppure `type: cover`. Se omesso, viene **inferito** dal contenuto.

| Elemento          | Sintassi                                  | Campo        |
|-------------------|-------------------------------------------|--------------|
| Tipo              | `:: tipo` / `<!-- type: tipo -->` / `type: tipo` | `type` |
| Titolo            | `# Titolo`                                | `title`      |
| Sottotitolo       | `## Sottotitolo` o `subtitle: ...`        | `subtitle`   |
| Paragrafo         | riga di testo libera                      | `body`       |
| Citazione         | `> testo`                                 | `body`       |
| Bullet            | `- voce` o `* voce`                       | `bullets[]`  |
| KPI               | `valore \| etichetta`                     | `kpi[]`      |
| Immagine          | `![](path)` o `image: path`               | `image`      |
| Tema              | `theme: dark` / `theme: light`            | `theme`      |
| Topic (landing)   | `topic: NomeColonna`                      | `topic`      |
| Note presentatore | `note: ...`                               | `note`       |

**Formattazione inline**: `**grassetto**`, `*corsivo*`, `` `code` ``,
`==evidenziato==` (accento giallo), `[testo](url)` (url filtrate: `http(s)`, `/`,
`./`, `#`, `mailto:`; `javascript:` viene scartato).

Esempio minimo:

```markdown
:: cover
# LA MIA PRESENTAZIONE
## Sottotitolo on-brand

---

:: kpi
topic: Risultati
# I numeri
+142% | ROAS medio
3.8M | impression
```

Lo **schema preciso** (modello `Slide`, alias, inferenza del tipo, contratto DOM,
classi CSS, animazioni) e' documentato in **[SPEC.md](./SPEC.md)**.
Una demo completa con tutti i tipi di slide e due topic e' in
**[`samples/esempio.md`](./samples/esempio.md)**.

---

## Come esportare

Premi **Esporta HTML** nella toolbar: viene generato e scaricato un singolo file
`.html` **autonomo**, che include CSS e motore di navigazione inline e i modelli
slide gia' serializzati. Non richiede l'editor ne' altri file del progetto: si
apre con un doppio click o si pubblica cosi' com'e'.

L'export rispetta la **modalita'** (deck/landing) e il **tema** correnti
dell'anteprima. I loghi vengono incorporati come `data:` URI quando possibile,
cosi' il file resta portabile.

---

## Pubblicazione su GitHub Pages

Il progetto e' pensato per **GitHub Pages**: usa esclusivamente **path relativi**,
nessun CDN obbligatorio e nessuno step di build. E' sufficiente pubblicare la root
del repository (branch + cartella) e l'app sara' raggiungibile aprendo `index.html`.

---

## Struttura del progetto

```
index.html              shell app: editor a sx + anteprima a dx
src/design-tokens.css   variabili colore / spaziatura / tipografia / animazioni
src/fonts.css           @font-face Raleway (.ttf locali)
src/slides.css          stili di tutti i tipi di slide + animazioni
src/editor.css          stili interfaccia editor + layout navigazione
src/parser.js           markdown -> Slide[]  (window.OFG.parse)
src/renderer.js         Slide -> DOM         (window.OFG.renderSlide/renderDeck)
src/engine.js           navigazione deck/landing  (window.OFG.Engine)
src/editor.js           UI editor, preview live, toggle, export
src/export.js           HTML autonomo scaricabile (window.OFG.exportHTML)
samples/esempio.md      demo con tutti i tipi di slide e due topic
assets/                 font Raleway (.ttf) + logo OFG (nero / negativo)
SPEC.md                 contratto tecnico tra i moduli
```

Tutti i moduli condividono il namespace globale `window.OFG`.
