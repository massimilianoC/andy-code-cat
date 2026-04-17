# LLM JSON Parsing — Linee Guida e Tecniche

Guida pratica e riusabile per gestire risposte JSON generate da LLM nei sistemi di produzione.
Estratta e generalizzata dalla pipeline `llmParser.ts` di questo progetto.

---

## Indice

1. [Il problema](#il-problema)
2. [Architettura generale](#architettura-generale)
3. [Fase 1 — Pulizia pre-parsing](#fase-1--pulizia-pre-parsing)
4. [Fase 2 — Estrazione candidati](#fase-2--estrazione-candidati)
5. [Fase 3 — Catena di repair strategies](#fase-3--catena-di-repair-strategies)
6. [Fase 4 — Selezione risultato migliore](#fase-4--selezione-risultato-migliore)
7. [Fase 5 — Post-parse normalizzazione](#fase-5--post-parse-normalizzazione)
8. [Validazione strutturale dei campi](#validazione-strutturale-dei-campi)
9. [Naming conventions](#naming-conventions)
10. [Tabella dei bug LLM coperti](#tabella-dei-bug-llm-coperti)
11. [Pitfall comuni](#pitfall-comuni)
12. [Sequenza di applicazione raccomandata](#sequenza-di-applicazione-raccomandata)

---

## Il problema

I modelli LLM producono JSON che occasionalmente fallisce `JSON.parse()` per motivi ricorrenti:

- Fence markdown (`\`\`\`json ... \`\`\``) inseriti intorno all'output
- Caratteri di controllo non escapati dentro stringhe (`\n`, `\r`, `\t` letterali)
- Escape invalidi (`\>`, `\`, ecc.) non riconosciuti dallo standard JSON
- Terminazione prematura di stringa: una `"` non preceduta da `\` ma non in posizione di chiusura valida
- Risposta troncata a causa del limite `max_tokens` con oggetti/array non chiusi
- Doppio encoding HTML (`lang=\"it\"` invece di `lang="it"`)
- Tag HTML malformati nel valore HTML (`<h11>`, `</>`)
- Stringhe vuote o wrapper `<style>`/`<script>` nelle sezioni CSS/JS
- Token spuri tra campi JSON (es. modello Hunyuan: `>",` tra due field)

---

## Architettura generale

```
rawLlmOutput
    │
    ▼
[1] Pulizia pre-parse (fence stripping, pre-repair)
    │
    ▼
[2] Generazione candidati multipli (stripped, fenced, extracted, pre-repaired...)
    │
    ▼
[3] Per ogni candidato → catena di repair strategies
    │   ├─ Direct JSON.parse
    │   ├─ repairInvalidJsonEscapes
    │   ├─ triple-pass (escape + premature-termination + escape)
    │   ├─ repairTruncatedJson
    │   └─ jsonrepair (last resort)
    │
    ▼
[4] Selezione del risultato con score più alto
    │
    ▼
[5] Post-parse normalizzazione (HTML, CSS/JS, campi duplicati)
    │
    ▼
Risultato canonico validato
```

---

## Fase 1 — Pulizia pre-parsing

### 1.1 Strip markdown fence

Rimuovere i delimitatori \`\`\`json ... \`\`\` con string operations (più robusto di regex quando il contenuto è enorme):

```ts
let stripped = trimmed;
if (stripped.startsWith("```")) {
    stripped = stripped.replace(/^```(?:json)?\s*\n?/i, "");
    const lastFence = stripped.lastIndexOf("```");
    if (lastFence > 0) stripped = stripped.slice(0, lastFence).trim();
}
// Fallback con regex per fences embedded nel testo
const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/is);
```

**Regola:** applicare SEMPRE prima di qualsiasi altro repair. Mai affidarsi a JSON.parse sul raw.

### 1.2 Pre-repair prima dell'estrazione

Alcuni modelli (es. gemma) terminano prematuramente una stringa con `"` non escaped. Questo fa sì che `extractFirstJsonObject` conti erroneamente le parentesi graffe dentro l'HTML e restituisca un oggetto troncato.

Soluzione: applicare il repair delle escape e delle terminazioni premature PRIMA di estrarre il primo oggetto:

```ts
const preRepaired = repairInvalidJsonEscapes(
    repairPrematureStringTermination(repairInvalidJsonEscapes(trimmed))
);
```

---

## Fase 2 — Estrazione candidati

Generare più versioni candidate dello stesso input e deduplicarle:

```ts
const rawCandidates = [
    stripped !== trimmed ? stripped : null,          // fence-stripped
    fenceMatch?.[1]?.trim() ?? null,                  // regex-fence
    extractFirstJsonObject(trimmed),                  // brace-scan raw
    extractFirstJsonObject(preRepaired),              // brace-scan pre-repaired
    extractFirstJsonObject(stripped),                 // brace-scan stripped
    gtRepaired !== source ? gtRepaired : null,        // stray-gt-repaired
    gtRepaired !== source ? extractFirstJsonObject(gtRepaired) : null,
];
// Deduplicazione order-preserving
const seen = new Set<string>();
const candidates = rawCandidates.filter(c => c && !seen.has(c) && seen.add(c));
```

### extractFirstJsonObject — state machine brace-depth

```ts
function extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) { escaped = false; }
            else if (ch === "\\") { escaped = true; }
            else if (ch === '"') { inString = false; }
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "{") depth++;
        if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
}
```

**Regola critica:** l'estrazione deve usare una state machine che rispetti `inString + escaped`. Mai usare `indexOf("{")` / `lastIndexOf("}")` senza tracking delle stringhe — ogni `{` dentro HTML conta come depth.

---

## Fase 3 — Catena di repair strategies

Applicare in ordine dal meno al più invasivo. Fermarsi al primo successo per candidato, poi confrontare i punteggi.

### Strategy 1 — Direct parse

```ts
JSON.parse(candidate)
```

### Strategy 2 — `repairInvalidJsonEscapes`

Corregge due classi di errori dentro stringhe JSON:

**a) Escape sequences invalide** (`\>`, `\`, ecc.):

```ts
// Se il carattere dopo \ non è uno dei validi JSON (\", \\, \/, \b, \f, \n, \r, \t, \u)
// → sostituire con \\ + char (mantiene il backslash letterale)
out += "\\\\";
out += ch;
```

**b) Caratteri di controllo non escapati** (LLM emette newline reale dentro stringa):

```ts
if (code === 0x0a) { out += "\\n"; continue; }  // newline
if (code === 0x0d) { out += "\\r"; continue; }  // carriage return
if (code === 0x09) { out += "\\t"; continue; }  // tab
```

Pattern base della state machine (uguale in tutte le funzioni di repair):

```ts
let inString = false, escaped = false;
for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!inString) {
        if (ch === '"') inString = true;
        out += ch;
        continue;
    }
    if (escaped) { escaped = false; /* processa ch */ continue; }
    if (ch === "\\") { escaped = true; out += ch; continue; }
    if (ch === '"') { inString = false; out += ch; continue; }
    // → qui siamo dentro una stringa, non in escape
}
```

### Strategy 3 — Triple-pass (gemma pattern)

```ts
repairInvalidJsonEscapes(
    repairPrematureStringTermination(
        repairInvalidJsonEscapes(candidate)
    )
)
```

**Perché triple:** alcuni modelli emettono `\"` corretti per aprire attributi HTML ma li chiudono con una `"` senza backslash. Il primo pass di `repairInvalidJsonEscapes` non tocca le `"` (non sono escape sequence), quindi serve `repairPrematureStringTermination` a riconoscere le chiusure premature, poi un secondo pass di escape repair.

### `repairPrematureStringTermination`

Logica: quando si incontra una `"` dentro una stringa, fare lookahead (skippa whitespace) e verificare se il carattere successivo è un valido terminatore di valore JSON:

```ts
if (ch === '"') {
    let j = i + 1;
    while (j < input.length && /\s/.test(input[j])) j++;
    const nextCh = j < input.length ? input[j] : "";
    // ":" è necessario per le chiavi JSON — senza, ogni key verrebbe "interna"
    if (nextCh === "," || nextCh === "}" || nextCh === "]" || nextCh === ":" || nextCh === "") {
        out += '"';
        inString = false;
    } else {
        out += '\\"';  // prematura: escapa
    }
    continue;
}
```

**Pitfall critico:** senza `":"` tra i caratteri validi, **ogni chiave JSON** (`"key":`) viene interpretata come terminazione prematura, corrompendo tutto il documento. Il `":"` è il separatore chiave-valore — la `"` che chiude una chiave è sempre seguita da `:`.

### Strategy 4 — `repairTruncatedJson`

Usato quando il modello ha colpito il limite `max_tokens` e la risposta finisce nel mezzo di una stringa o con oggetti/array aperti.

```ts
function repairTruncatedJson(input: string): string {
    const stack: ("{" | "[")[] = [];
    let inString = false, escaped = false;
    // ... scan per tracciare stack di {[ aperti ...
    let suffix = "";
    if (inString) suffix += '"';           // chiudi stringa aperta
    for (let i = stack.length - 1; i >= 0; i--)
        suffix += stack[i] === "{" ? "}" : "]";  // chiudi in ordine inverso
    return input + suffix;
}
```

**Nota:** il risultato è un JSON parziale — il contenuto dell'ultimo campo può essere troncato. Per questo si usa lo scoring per preferire risultati completi.

### Strategy 5 — `jsonrepair` (library)

```ts
import { jsonrepair } from "jsonrepair";
JSON.parse(jsonrepair(candidate));
```

Last resort. Copre pattern non previsti ma può introdurre trasformazioni non desiderate. Applicare solo se tutte le strategie precedenti falliscono.

### Repair aggiuntivo — `repairStrayGtBetweenFields` (Hunyuan-A13B)

Alcuni modelli emettono un token `>",` spurio tra campi JSON (residuo del `>` finale dell'HTML che "sfugge" fuori dalla stringa):

```
"html": "...</html>",
>"`,             ← SPURIO
"css": "..."
```

Soluzione: detectare `>` fuori da stringa seguito da `"` opzionale + `,` opzionale, verificare che il prossimo carattere significativo sia `"` (nuovo field), e saltare la sequenza spuria:

```ts
if (ch === ">") {
    let j = i + 1;
    if (input[j] === '"') j++;
    if (input[j] === ',') j++;
    // salta whitespace
    let k = j;
    while (k < input.length && /\s/.test(input[k])) k++;
    if (input[k] === '"') {
        i = j - 1;  // salta il token spurio
        continue;
    }
    out += ch;
}
```

---

## Fase 4 — Selezione risultato migliore

Quando più candidati parsano con successo, scegliere quello con **score più alto** — non il primo. Questo evita che un repair `repairTruncatedJson` su un candidato degradato "vinca" su un parse diretto completo di un candidato migliore.

### Funzione di scoring

```ts
function scoreResult(r: ParsedResult): number {
    let score = 0;
    const html = r.artifacts.html;
    score += Math.min(html.length, 50000) / 100;    // più HTML = meglio
    if (/<!doctype\s+html/i.test(html)) score += 100;  // documento completo
    else if (/<html\b/i.test(html)) score += 80;
    if (/<\/html>/i.test(html)) score += 60;           // chiuso correttamente
    if (/<head\b/i.test(html)) score += 20;
    if (/<body\b/i.test(html)) score += 20;
    if (r.chat.summary.length > 10) score += 20;
    if (r.chat.bullets.length > 0) score += 10;
    if (r.artifacts.css.length > 50) score += 15;
    if (r.artifacts.js.length > 0) score += 3;
    return score;
}
```

**Principio:** un parse troncato ha sempre HTML più corto e manca di `</html>` → score basso → viene scartato se esiste un parse completo.

---

## Fase 5 — Post-parse normalizzazione

### 5.1 `unescapeDoubleEncodedHtml`

Alcuni modelli double-encodano gli attributi HTML nel JSON (`lang=\"it\"` → nel valore HTML diventa `lang=\"it\"` invece di `lang="it"`):

```ts
function unescapeDoubleEncodedHtml(html: string): string {
    if (!html.includes('=\\"')) return html;  // fast path
    return html
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
}
```

**Regola:** applicare SOLO se il pattern `=\"` è presente — evita trasformazioni indesiderate su HTML normale.

### 5.2 `normalizeHtmlArtifact`

Corregge aberrazioni markup post-parse:

```ts
function normalizeHtmlArtifact(html: string): string {
    if (!html) return html;
    return html
        // Heading tags con cifra doppia: <h11> → <h1>, </h33> → </h3>
        .replace(/<(\/?)h(\d)\2>/gi, "<$1h$2>")
        // Tag di chiusura vuoti </> — non standard, rimuovere
        .replace(/<\/>/g, "");
}
```

### 5.3 `normalizeArtifactCssJs`

Alcuni modelli avvolgono CSS/JS con i rispettivi tag nonostante le istruzioni contrarie:

```ts
function normalizeArtifactCssJs(content: string, kind: "css" | "js"): string {
    const trimmed = content.trim();
    if (!trimmed) return "";
    if (kind === "css") {
        const match = trimmed.match(/^<style[^>]*>([\s\S]*?)<\/style>$/i);
        return (match?.[1] ?? trimmed).trim();
    }
    const match = trimmed.match(/^<script[^>]*>([\s\S]*?)<\/script>$/i);
    return (match?.[1] ?? trimmed).trim();
}
```

### 5.4 Fallback: estrazione CSS/JS dall'HTML

Quando `artifacts.css` e `artifacts.js` sono vuoti ma il modello ha inserito tutto inline nell'HTML:

```ts
function extractArtifactsFromHtml(html: string): { css: string; js: string } {
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const css = styleMatch?.[1]?.trim() ?? "";
    // Solo script senza src= (esclude CDN esterni)
    const scriptMatch = html.match(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/i);
    const js = scriptMatch?.[1]?.trim() ?? "";
    return { css, js };
}
```

**Regola:** applicare il fallback solo se il campo è vuoto dopo `normalizeArtifactCssJs`.

---

## Validazione strutturale dei campi

Dopo il parsing, validare ogni campo opzionale in modo esplicito prima di accettarlo:

```ts
function extractFocusPatch(parsed: Partial<LlmResponse>): FocusPatch | undefined {
    const fp = parsed.focusPatch;
    if (!fp) return undefined;
    // Enum check
    if (!["html", "css", "js"].includes(fp.targetType)) return undefined;
    // Campo opzionale: se presente deve essere stringa non vuota
    if (fp.anchor !== undefined && (typeof fp.anchor !== "string" || !fp.anchor.trim())) return undefined;
    // Campo obbligatorio: stringa non vuota
    if (typeof fp.replacement !== "string" || !fp.replacement.trim()) return undefined;
    return fp;
}
```

**Principi:**

- Distinguere tra campi **opzionali** (`!== undefined` prima del type check) e **obbligatori**
- Usare `trim()` per evitare stringhe di soli spazi
- I controlli enum devono essere espliciti, non affidarsi al type system a runtime
- Restituire `undefined` (non `null`) per campi opzionali assenti

### Assemblaggio canonico con defaults

```ts
function assembleResult(parsed: Partial<LlmResponse>): LlmResponse | null {
    if (!parsed?.chat || !parsed?.artifacts) return null;
    return {
        chat: {
            summary: String(parsed.chat.summary ?? ""),
            bullets: Array.isArray(parsed.chat.bullets) ? parsed.chat.bullets.map(String) : [],
            nextActions: Array.isArray(parsed.chat.nextActions) ? parsed.chat.nextActions.map(String) : [],
        },
        artifacts: { html: htmlStr, css: cssStr, js: jsStr },
        focusPatch: extractFocusPatch(parsed),
    };
}
```

**Regole:**

- `String(value ?? "")` per i campi stringa obbligatori — mai assumere che un campo sia già stringa
- `Array.isArray(arr) ? arr.map(String) : []` per array — mai assumere il tipo degli elementi
- Centralizzare l'assemblaggio in una funzione — non duplicarlo in ogni branch try-catch

---

## Naming conventions

| Pattern | Snake_case | camelCase | Significato |
|---|---|---|---|
| Funzione di repair | — | `repairXxx` | Trasforma una stringa, non modifica lo stato |
| Funzione di normalizzazione | — | `normalizeXxx` | Pulisce/uniforma un valore già parsato |
| Funzione di estrazione | — | `extractXxx` | Ricava un sottoinsieme da un valore più grande |
| Funzione di validazione campo | — | `extractXxx` | Valida + restituisce il campo o undefined |
| Funzione di assemblaggio | — | `assembleXxx` | Costruisce il risultato canonico finale |
| Funzione di scoring | — | `scoreXxx` | Calcola il punteggio qualitativo di un risultato |
| Funzione di parsing pubblica | — | `tryParseXxx` | Entry point pubblica, restituisce `{ result, valid }` |

**Regole di naming:**

- `repair*` non lancia eccezioni — restituisce sempre una stringa
- `try*` cattura le eccezioni internamente — restituisce `null` o `{ valid: false }` in caso di fallimento
- `assemble*` restituisce `null` se i campi obbligatori sono assenti
- I nomi dei repair descrivono **cosa correggono**, non il modello che li causa (es. `repairPrematureStringTermination` non `repairGemmaDoubleQuoteBug`)

---

## Tabella dei bug LLM coperti

| Bug | Modelli noti | Funzione di repair |
|---|---|---|
| Fence markdown `\`\`\`json` attorno alla risposta | quasi tutti | fence stripping (fase 1) |
| Escape sequence invalide (`\>`, `\`) | vari | `repairInvalidJsonEscapes` |
| Newline/tab letterali dentro stringhe JSON | vari | `repairInvalidJsonEscapes` |
| Terminazione prematura di stringa con `"` non escaped | gemma, phi | `repairPrematureStringTermination` |
| Risposta troncata per `max_tokens` | tutti | `repairTruncatedJson` |
| Doppio encoding HTML `lang=\"it\"` | qwen, mistral | `unescapeDoubleEncodedHtml` |
| Tag heading duplicati `<h11>` | vari | `normalizeHtmlArtifact` |
| Tag chiusura vuoti `</>` | vari | `normalizeHtmlArtifact` |
| CSS/JS avvolti in `<style>`/`<script>` | vari | `normalizeArtifactCssJs` |
| CSS/JS vuoti ma inline nell'HTML | vari | `extractArtifactsFromHtml` |
| Token spurio `>",` tra campi JSON | Hunyuan-A13B | `repairStrayGtBetweenFields` |

---

## Pitfall comuni

### ❌ Repair che non rispetta le boundaries delle stringhe

```ts
// SBAGLIATO: regexp globale sulla stringa raw — colpisce anche i valori HTML
json.replace(/\n/g, "\\n")

// CORRETTO: state machine che traccia inString + escaped
```

### ❌ `repairPrematureStringTermination` senza il caso `":"`

```ts
// SBAGLIATO: manca ":" → ogni chiave JSON viene "tenuta aperta"
if (nextCh === "," || nextCh === "}" || nextCh === "]" || nextCh === "") {

// CORRETTO
if (nextCh === "," || nextCh === "}" || nextCh === "]" || nextCh === ":" || nextCh === "") {
```

### ❌ Prendere il primo parse riuscito invece del migliore

```ts
// SBAGLIATO: repairTruncatedJson su un candidato degradato "vince"
for (const candidate of candidates) {
    const result = tryParseWithRepairs(candidate);
    if (result) return result;  // ← primo successo, può essere troncato
}

// CORRETTO: raccogliere tutti i successi, restituire il migliore per score
```

### ❌ Applicare `unescapeDoubleEncodedHtml` sempre

```ts
// SBAGLIATO: trasforma HTML normale che non ne ha bisogno
const html = unescapeDoubleEncodedHtml(rawHtml);

// CORRETTO: fast path con check preventivo
if (!html.includes('=\\"')) return html;
```

### ❌ Duplicare la logica di assemblaggio in ogni branch

```ts
// SBAGLIATO: ogni catch/else riassembla il risultato a modo suo
// CORRETTO: una sola funzione assembleResult() chiamata da tutte le branch
```

### ❌ Usare `"` standard negli attributi HTML all'interno di JSON

Quando il prompt istruisce un LLM a generare HTML dentro JSON, imporre **virgolette singole** per tutti gli attributi HTML:

```
// Nel system prompt al LLM:
Use single quotes for ALL HTML attributes.
WRONG: <html lang="it">
RIGHT: <html lang='it'>
```

Questo elimina alla radice il 90% dei problemi di escape HTML-in-JSON.

---

## Sequenza di applicazione raccomandata

```
Input raw LLM
    │
    ├─1─ trim()
    ├─2─ fence strip (string ops + regex fallback)
    ├─3─ repairStrayGtBetweenFields (modelli con artefatti token)
    ├─4─ pre-repair: repairInvalidJsonEscapes(repairPrematureStringTermination(repairInvalidJsonEscapes(raw)))
    │
    ├─ Genera candidati (deduplicati):
    │     [ stripped, fenceMatch, extractFirstJsonObject(raw),
    │       extractFirstJsonObject(preRepaired), extractFirstJsonObject(stripped),
    │       gtRepaired, extractFirstJsonObject(gtRepaired) ]
    │
    ├─ Per ogni candidato, applica strategies:
    │     1. JSON.parse(candidate)
    │     2. JSON.parse(repairInvalidJsonEscapes(candidate))
    │     3. JSON.parse(repairInvalidJsonEscapes(repairPrematureStringTermination(repairInvalidJsonEscapes(candidate))))
    │     4. JSON.parse(repairTruncatedJson(repairInvalidJsonEscapes(candidate)))
    │     5. JSON.parse(jsonrepair(candidate))
    │
    ├─ Raccogli tutti i risultati validi → seleziona per score
    │
    ├─ Post-parse:
    │     unescapeDoubleEncodedHtml(html)
    │     normalizeHtmlArtifact(html)
    │     normalizeArtifactCssJs(css, "css")
    │     normalizeArtifactCssJs(js, "js")
    │     extractArtifactsFromHtml(html)  ← solo se css/js vuoti
    │
    └─ assembleResult() → risultato canonico validato
```

---

## Riferimento implementativo

File sorgente nel progetto: `apps/api/src/application/llm/llmParser.ts`

Dipendenza esterna: [`jsonrepair`](https://www.npmjs.com/package/jsonrepair) — usata come last resort nella strategy 5.
