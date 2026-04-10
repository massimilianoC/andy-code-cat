# Andy Code Cat — Prompt Optimizer: Specifiche Dettagliate

> **Versione:** 1.0.0 — 2026-04-09  
> **Autore:** architettura di prodotto  
> **Scope:** UX interattiva e architettura backend per il servizio "Ottimizza Prompt"  
> **Dipendenze architetturali:** LLM Catalog (✅), UserStyleProfile (✅), ProjectMoodboard (✅), Asset Manager (✅)  
> **Milestone:** R0 — in `docs/DEVELOPMENT_PLAN.md`

---

## 0. Motivazione e Problema

### 0.1 Il Gap Attuale

L'utente oggi deve portare **manualmente** il proprio contesto a strumenti AI esterni per ottenere un prompt elaborato:

1. Apre un editor AI esterno (ChatGPT, Claude, Gemini)
2. Incolla brief, allegati, specifiche del progetto
3. Chiede "preparami un prompt per generare il sito web"
4. Copia il risultato nel workspace di Andy Code Cat
5. Invia al motore di generazione

Questo flusso è **lento, discontinuo e privo di contesto strutturato** (il profilo utente, il moodboard progetto, e la tipologia di output non vengono passati automaticamente all'AI esterna).

### 0.2 Obiettivo

Internalizzare questa attività nel workspace. Il Prompt Optimizer deve:

1. Leggere l'input grezzo dell'utente (testo libero, breve o lungo)
2. Leggere il contesto strutturato disponibile: profilo utente + moodboard progetto + allegati
3. Chiamare un LLM dedicato con istruzioni **esclusivamente contenutistiche**
4. Restituire un prompt arricchito e strutturato che **sostituisce** il testo dell'utente nella textarea
5. L'utente può rivedere, editare, e inviare

### 0.3 Perimetro — Cosa Ottimizza e Cosa No

| Ambito | Incluso nel Prompt Optimizer | Gestito da altro layer |
|---|---|---|
| Obiettivi di business della pagina | ✅ | — |
| Caratterizzazione del pubblico target | ✅ | — |
| Messaggio principale e call-to-action | ✅ | — |
| Struttura e direzione dei contenuti | ✅ | — |
| Uso di media (immagini, video, icone) | ✅ | — |
| Tono comunicativo del testo | ✅ | — |
| Elementi di contenuto da allegati/PDF | ✅ | — |
| Palette colori, typography, font | ❌ | Layer C (Style Context Block) |
| Framework CSS (Tailwind, Bootstrap) | ❌ | Layer A (Base Constraints) |
| Struttura HTML, sezioni tecniche | ❌ | Layer B (Preset Output Module) |
| Grid layout, breakpoints responsivi | ❌ | Layer A + Layer B |
| Tipo di output (landing page, A4, slide) | ❌ | Preset selection (Layer B) |

> **Principio chiave:** il Prompt Optimizer lavora sul **messaggio dell'utente**, non sul system prompt tecnico. Non sa e non deve sapere come verrà prodotto l'output HTML/CSS.

---

## 1. Posizione Architetturale

```
┌──────────────────────────────────────────────────────────────────┐
│                   Workspace Chat Input                            │
│                                                                   │
│  L'utente scrive: "Voglio una pagina per il mio studio legale"   │
│  [📎 allegati: logo.png, brochure.pdf]                           │
│                                                                   │
│  [✨ Ottimizza prompt]  ← NUOVO BOTTONE                          │
│                │                                                  │
│                ▼                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  PROMPT OPTIMIZER (nuovo servizio)                       │     │
│  │                                                          │     │
│  │  Input:                                                  │     │
│  │    • rawPrompt: "Voglio una pagina per lo studio..."     │     │
│  │    • UserStyleProfile → identità, settore, tono         │     │
│  │    • ProjectMoodboard → audience, feature, note libere  │     │
│  │    • Allegati → testo PDF, descrizione immagini         │     │
│  │                                                          │     │
│  │  LLM ottimizzatore (modello configurabile, content-only) │     │
│  │  System Instruction: "Sei un content strategist..."      │     │
│  │                                                          │     │
│  │  Output:                                                 │     │
│  │    • enhancedPrompt (sostituisce textarea)               │     │
│  └──────────────────────────┬──────────────────────────────┘     │
│                              │                                    │
│  Textarea aggiornata con il prompt arricchito                     │
│  L'utente legge, modifica se vuole → [Invia]                     │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
          ┌────────────────────────────────────────┐
          │  Pipeline system prompt esistente        │
          │                                          │
          │  Layer A — Base Architectural Constraints│
          │  Layer B — Preset Output Module          │
          │  Layer C — Style Context Block           │
          │  Layer D — prePromptTemplate             │
          │                                          │
          │  + enhancedPrompt come USER message      │
          └──────────────────────────────────────────┘
```

Il Prompt Optimizer opera **sul lato utente** della conversazione, non sul system prompt. Il suo output diventa il messaggio utente che entra nei layer A–D esistenti.

---

## 2. UX Flow — "Ottimizza Prompt"

### 2.1 Stati del Bottone

| Stato utente | Comportamento UI |
|---|---|
| Textarea vuota | Bottone non visibile |
| L'utente inizia a digitare (≥ 10 caratteri) | Bottone `[✨ Ottimizza]` appare inline sotto la textarea |
| L'utente ha allegati senza testo | Bottone visibile con label `[✨ Descrivi con AI]` |
| Ottimizzazione in corso | Bottone disabilitato, spinner + "Elaborazione…" |
| Ottimizzazione completata | Textarea aggiornata, bottone torna a stato normale |
| Errore LLM | Toast di errore, textarea invariata, bottone ripristinato |

### 2.2 Flusso Dettagliato

```
1. UTENTE SCRIVE
   Textarea: "vorrei un sito per il mio ristorante, ho il menù e le foto"
   Allegati: [menu.pdf] [interno.jpg] [piatto-signatura.jpg]
   
   ↓ appare [✨ Ottimizza prompt]

2. UTENTE CLICCA [✨ Ottimizza prompt]
   → POST /v1/projects/:id/llm/optimize-prompt
   → Loading indicator + "Arricchisco il tuo prompt…"
   → Textarea disabilitata durante chiamata

3. BACKEND
   a. Carica ProjectMoodboard + UserStyleProfile
   b. Estrae testo da menu.pdf (pdf-parse, max 5000 char)
   c. Descrive immagini via vision LLM se modello supportato
      (oppure usa solo filename/metadata se no vision)
   d. Chiama LLM ottimizzatore con system instruction content-only
   e. Riceve prompt arricchito

4. FRONTEND AGGIORNA
   Textarea sostituita con:
   ────────────────────────────────────────────
   Crea la pagina web del Ristorante [nome dal PDF/moodboard].
   
   Obiettivo principale: attrarre clienti locali e consentire la
   consultazione del menù online, con una call-to-action per le
   prenotazioni telefoniche o tramite form.
   
   Sezioni chiave da comunicare:
   - Hero section con immagine appetitosa del piatto signature
     (usa le foto allegate come riferimento visivo)
   - Presentazione del menù con sezioni antipasti, primi, secondi,
     dessert (testo dal menù allegato)
   - Storytelling del ristorante: atmosfera, storia, valori
     (tono: caldo, italiano, tradizione con modern twist)
   - Sezione prenotazioni con numero di telefono e form semplice
   - Gallery fotografica con 3-4 immagini degli interni e dei piatti
   
   Pubblico target: famiglie e coppie locali, turisti in zona,
   cercatori di ristoranti tradizionali italiani.
   
   Contenuti multimediali da includere:
   - Immagine hero: foto piatto signature (allegata)
   - Gallery: immagini interni e piatti (allegate)
   - Icone decorative: posate, stelle, mappa pin per indicazioni
   ────────────────────────────────────────────

5. UTENTE LEGGE, MODIFICA SE NECESSARIO → [Invia]
   Il prompt arricchito entra nel sistema come USER message.
```

### 2.3 Regole UX

| Regola | Dettaglio |
|---|---|
| **Non-distruttivo** | Il bottone non sostituisce silenziosamente — l'utente vede sempre il risultato prima di inviare. |
| **Editabile dopo** | La textarea rimane editabile dopo l'ottimizzazione. L'utente può sempre correggere. |
| **Annullabile** | Pulsante "Ripristina" (undo) per tornare al testo originale per X secondi dopo la sostituzione. |
| **Non obbligatorio** | Il flusso normale (scrivi → invia) funziona sempre senza ottimizzazione. |
| **Allegati preservati** | Gli allegati restano allegati alla sessione anche dopo l'ottimizzazione. |
| **Iterabile** | L'utente può cliccare di nuovo "Ottimizza" sul prompt già ottimizzato per un'ulteriore passata. |

---

## 3. Backend — PromptOptimizer Service

### 3.1 Architettura del Servizio

```
apps/api/src/
  application/
    llm/
      promptOptimizer/
        PromptOptimizerService.ts       ← orchestratore principale
        OptimizerContextBuilder.ts      ← assembla contesto da profilo + allegati
        OptimizerSystemInstruction.ts   ← genera l'istruzione per l'LLM ottimizzatore
        OptimizerAttachmentProcessor.ts ← estrae contenuto da allegati per context
        OptimizerModelResolver.ts       ← risolve il modello da usare
```

### 3.2 Interfacce

```typescript
// Input al servizio
interface PromptOptimizerInput {
  rawPrompt: string;                    // testo grezzo dell'utente (può essere breve)
  attachmentIds?: string[];             // ID asset da includere come contesto contenuto
  projectId: string;                    // per caricare moodboard + preset
  userId: string;                       // per caricare profilo utente
  modelOverride?: string;               // override modello ottimizzatore a livello chiamata
}

// Output del servizio
interface PromptOptimizerOutput {
  enhancedPrompt: string;               // prompt arricchito da mostrare in textarea
  contentSignals: {                     // meta-info (non mostrato all'utente, utile per debug)
    detectedObjective?: string;         // obiettivo dedotto dall'input
    suggestedMediaTypes: string[];      // es. ["hero-image", "gallery", "icon-set"]
    toneDetected?: string;              // tono dedotto
    attachmentsProcessed: number;       // quanti allegati sono stati inclusi
    contextTokensUsed: number;          // token usati per il contesto
  };
  processingTimeMs: number;
}

// Interfaccia pubblica del servizio
interface PromptOptimizerService {
  optimize(input: PromptOptimizerInput): Promise<PromptOptimizerOutput>;
}
```

### 3.3 OptimizerContextBuilder

Assembla il contesto strutturato da passare all'LLM ottimizzatore:

```typescript
interface OptimizerContext {
  // Identità del progetto (estratta da moodboard + preset)
  project: {
    type?: string;               // landing_page, mini_site, ecc. (dal preset)
    audienceTags?: string[];     // target audience
    featureTags?: string[];      // componenti desiderati
    toneTags?: string[];         // stile comunicativo
    freeNotes?: string;          // note libere del moodboard
    brief?: string;              // brief del progetto
  };
  
  // Identità dell'utente (estratta da UserStyleProfile)
  user: {
    identityTags?: string[];     // chi è (freelancer, agency, ecc.)
    sectorTags?: string[];       // settore di business
    freeDescription?: string;    // descrizione libera dell'attività
  };
  
  // Materiale allegato (estratto dall'Asset Manager)
  attachments: {
    pdfs: Array<{
      filename: string;
      extractedText: string;     // max 5000 char per file
      truncated: boolean;
    }>;
    images: Array<{
      filename: string;
      visualDescription?: string;  // da LLM vision se disponibile
    }>;
    other: Array<{
      filename: string;
      mimeType: string;
    }>;
  };
}
```

**Regole di risoluzione contesto:**

```
ProjectMoodboard presente     → usa campi moodboard (override utente)
ProjectMoodboard assente      → usa UserStyleProfile
Entrambi assenti              → solo rawPrompt + allegati (contesto minimale)
Allegati presenti             → processa e includi come contesto contenuto
```

### 3.4 OptimizerAttachmentProcessor

```typescript
class OptimizerAttachmentProcessor {
  
  // Per PDF: estrae testo con pdf-parse
  // Limite: 5000 char per file (soft cap — ottimizzato per input al LLM)
  // Nota: limite ridotto rispetto a PrepromptEngine (50.000 char) perché
  // il contesto serve solo per identificare il contenuto, non riprodurlo
  async extractPdfContent(assetPath: string): Promise<string> { ... }
  
  // Per immagini: usa LLM vision se disponibile nel modello selezionato
  // Se non disponibile: usa solo filename + EXIF metadata (dimensioni, data, ecc.)
  // L'obiettivo è capire "cosa c'è nell'immagine" — non descrivere in dettaglio
  async describeImage(assetPath: string, projectAiConfig: AiConfig): Promise<string> { ... }
  
  // Limiti di sicurezza
  readonly MAX_PDF_FILES = 3;      // max 3 PDF per singola chiamata optimizer
  readonly MAX_IMAGE_FILES = 6;    // max 6 immagini per singola chiamata optimizer
  readonly MAX_PDF_CHARS = 5000;   // char per singolo PDF
  readonly MAX_TOTAL_CONTEXT = 8000;  // char totali contesto allegati
}
```

---

## 4. System Instruction dell'Ottimizzatore

### 4.1 Principi dell'Istruzione

L'istruzione di sistema per l'LLM ottimizzatore deve:

1. **Limitarsi al contenuto** — nessuna istruzione tecnica (HTML, CSS, framework, layout)
2. **Essere context-aware** — usare profilo utente + moodboard + allegati
3. **Produrre un output leggibile** — un prompt in linguaggio naturale, non un JSON
4. **Includere le tre dimensioni chiave**: obiettivo, contenuto, media
5. **Rispettare il tono e l'identità** dedotti dal profilo

### 4.2 Template dell'Istruzione Sistema (Nunjucks)

```nunjucks
Sei un content strategist esperto nella creazione di brief per pagine web.

Il tuo compito è trasformare l'idea grezza dell'utente in un prompt di contenuto
strutturato e ricco, pronto per essere passato a un generatore di pagine web.

REGOLE FONDAMENTALI:
- Scrivi SOLO istruzioni di contenuto: obiettivi, messaggi chiave, sezioni, tono
- NON includere mai: nomi di framework (Bootstrap, Tailwind), proprietà CSS, tag HTML
- NON specificare: palette colori hex, font names, breakpoints, grid system
- NON decidere: il tipo di pagina (landing vs sito vs presentazione) — quel dato è già elsewhere
- MANTIENI la lingua dell'utente (italiano se scrive in italiano, inglese se in inglese)
- Lunghezza prompt output: tra 150 e 400 parole — conciso ma completo

{% if project.brief %}
BRIEF DEL PROGETTO:
{{ project.brief }}
{% endif %}

{% if project.freeNotes %}
NOTE AGGIUNTIVE DEL PROGETTO:
{{ project.freeNotes }}
{% endif %}

{% if user.freeDescription %}
PROFILO DELL'UTENTE (usalo per capire il contesto di business):
{{ user.freeDescription }}
{% endif %}

{% if project.audienceTags.length > 0 or user.identityTags.length > 0 %}
CONTESTO IDENTITÀ:
{% if user.identityTags.length > 0 %}- Chi: {{ user.identityTags | join(', ') }}{% endif %}
{% if user.sectorTags.length > 0 %}- Settore: {{ user.sectorTags | join(', ') }}{% endif %}
{% if project.audienceTags.length > 0 %}- Pubblico target: {{ project.audienceTags | join(', ') }}{% endif %}
{% endif %}

{% if project.toneTags.length > 0 %}
TONO COMUNICATIVO PREFERITO: {{ project.toneTags | join(', ') }}
{% endif %}

{% if attachments.pdfs.length > 0 %}
DOCUMENTI ALLEGATI (usali per estrarre contenuti chiave):
{% for pdf in attachments.pdfs %}
--- FILE: {{ pdf.filename }} ---
{{ pdf.extractedText }}
{% if pdf.truncated %}[... contenuto troncato per brevità]{% endif %}
{% endfor %}
{% endif %}

{% if attachments.images.length > 0 %}
IMMAGINI ALLEGATE (usale come riferimento per suggerire media):
{% for img in attachments.images %}
- {{ img.filename }}{% if img.visualDescription %}: {{ img.visualDescription }}{% endif %}
{% endfor %}
{% endif %}

STRUTTURA DEL PROMPT DA PRODURRE:
Il tuo output deve essere un prompt in linguaggio naturale che includa:
1. Obiettivo principale della pagina (cosa deve ottenere l'utente)
2. Pubblico target caratterizzato (chi la leggerà, motivazioni, linguaggio atteso)
3. Contenuti chiave organizzati in sezioni (con indicazioni su cosa dire in ciascuna)
4. Suggerimenti uso media (quando usare immagini, video, icone — fondamentali per comunicare)
5. Tono comunicativo (come si deve sentire il visitatore leggendo i testi)
6. Eventuali riferimenti ai materiali allegati (cosa usare dai documenti/immagini forniti)

NON includere nel tuo output:
- Parole come "HTML", "CSS", "JavaScript", "React", "div", "section"
- Specifiche tecniche di layout, colori, font
- Il tipo di formato (landing page, sito, poster) — è già configurato altrove
```

### 4.3 Configurazione del Modello Ottimizzatore

```typescript
interface OptimizerModelConfig {
  // Fonte primaria: variabile env dedicata
  // LLM_OPTIMIZER_MODEL_ID=siliconflow::Qwen/Qwen2.5-7B-Instruct
  // Se assente: usa il modello di default del progetto (project.aiConfig)
  // Se anche quello assente: usa il catalog default
  modelId?: string;
  
  // Parametri specifici per ottimizzazione
  maxTokens: number;       // default: 800 (output breve ma ricco)
  temperature: number;     // default: 0.7 (creativo ma coerente)
}

// Risoluzione priorità:
// 1. modelOverride nel request (override per-chiamata)
// 2. LLM_OPTIMIZER_MODEL_ID (env, per piattaforma)
// 3. project.aiConfig.modelId (modello del progetto)
// 4. catalog default model
```

---

## 5. API Endpoint

### 5.1 Route

```
POST /v1/projects/:id/llm/optimize-prompt
```

**Autenticazione:** JWT + sandbox check (user + project ownership)

### 5.2 Request Body

```typescript
interface OptimizePromptRequest {
  rawPrompt: string;           // required, min 1 char
  attachmentIds?: string[];    // ID asset già caricati nel progetto
  modelOverride?: string;      // opzionale: force un modello specifico
}
```

**Validazione Zod** (in `packages/contracts`):

```typescript
export const OptimizePromptRequestSchema = z.object({
  rawPrompt: z.string().min(1).max(2000),
  attachmentIds: z.array(z.string()).max(9).optional(),
  modelOverride: z.string().optional(),
});
```

### 5.3 Response

```typescript
// 200 OK
interface OptimizePromptResponse {
  enhancedPrompt: string;
  meta: {
    attachmentsProcessed: number;
    contextTokensUsed: number;
    processingTimeMs: number;
    modelUsed: string;         // quale modello ha risposto
  };
}

// 400 Bad Request — rawPrompt mancante
// 401 Unauthorized — JWT assente
// 403 Forbidden — sandbox check fallito
// 429 Too Many Requests — rate limit (max 10 ottimizzazioni/ora per utente)
// 500 Internal Server Error — fallimento LLM
```

### 5.4 Rate Limiting

Il Prompt Optimizer non contribuisce al usage LLM principale (non è generazione).
Ha un rate limit separato e permissivo: **10 chiamate/ora per utente**.
Non viene addebitato al credit system (se implementato in M5) o addebitato a tariffa ridotta.

---

## 6. Integrazione con Pipeline Esistente

### 6.1 Come il Prompt Ottimizzato Entra nel Flow

Il prompt ottimizzato non necessita modifiche al sistema di generazione esistente.
Entra semplicemente come `message.content` nel messaggio utente della conversazione,
esattamente come se l'utente l'avesse scritto a mano.

```typescript
// Nessuna modifica necessaria a buildMessagesWithHistory()
// Il prompt ottimizzato è un normale messaggio utente

// In ConversationService.addMessage():
await conversation.addUserMessage({
  content: enhancedPrompt,  // già ottimizzato
  attachments: [...],       // allegati invariati
  metadata: {
    optimized: true,        // flag opzionale per analytics
    originalPrompt: rawPrompt  // conserva originale per audit
  }
});
```

### 6.2 Relazione con i Layer A–D (R1)

Il Prompt Optimizer è **ortogonale** a R1 (Prompt Architecture Layer):

| Layer | Cosa controlla | Chi lo scrive |
|---|---|---|
| Layer A | Vincoli tecnici architetturali (HTML statico, nginx-ready) | Sistema (statico) |
| Layer B | Formato output (landing, slide, A4 — dal preset) | Sistema (dal preset) |
| Layer C | Contesto stilistico (palette, stile, tono — dal profilo) | Sistema (da profilo) |
| Layer D | Template pre-prompting per-progetto | Sistema (da config) |
| **User Message** | **Obiettivo contenuto, sezioni, media (dall'utente)** | **Utente (ottimizzato da R0)** |

R0 (questo spec) e R1 possono essere sviluppati in parallelo senza conflitti.

### 6.3 Conservazione dell'Originale

Il rawPrompt originale viene conservato in due punti:

1. **Metadata del messaggio** — `message.metadata.originalPrompt` (per debug/audit)
2. **Frontend state** — Undo buffer in memoria per X secondi (nessuna persistenza)

---

## 7. Gestione Allegati — Dual Strategy

### 7.1 Due Approcci per gli Allegati

Per il Prompt Optimizer, gli allegati vengono processati diversamente rispetto al PrepromptEngine (Layer 2):

| Approccio | Quando si usa | Logica |
|---|---|---|
| **Serializzazione diretta** | File piccoli (PDF < 20KB, immagini con vision) | Contenuto estratto/descritto e passato come testo nel contesto |
| **Sintesi abbreviata** | File grandi (PDF > 20KB) | Solo prime 5000 char + riassunto automatico |

L'obiettivo qui **non** è riprodurre il contenuto del documento nel prompt finale, ma **estrarre segnali** (cosa vende il ristorante, chi è il cliente, quale stile visivo aveva il logo...) per arricchire la direzione di contenuto.

### 7.2 RAG vs Serializzazione — Nota Architetturale

Per i casi futuri con basi documentali ampie (catalogo prodotti, manuale aziendale, portfolio esteso):

```
Scenario attuale (R0):
  PDF/immagine allegato → estrazione testo → inject nel context → LLM ottimizzatore
  Adeguato per: brochure, menù, brief, profilo aziendale (1-5 pagine)

Scenario futuro (milestone successiva, non in scope R0):
  Corpus di documenti esteso → chunking → embedding → vector DB → RAG retrieval
  Adeguato per: catalogo 200 prodotti, knowledge base aziendale
```

Il modulo `OptimizerAttachmentProcessor` è progettato per essere esteso con RAG
in futuro senza modificare l'interfaccia pubblica del servizio.

---

## 8. Piano Implementativo — R0

### R0.1 — Contratto e Servizio Backend

- [ ] `packages/contracts/src/promptOptimizer.ts` — `OptimizePromptRequestSchema`, `OptimizePromptResponseSchema`
- [ ] `apps/api/src/application/llm/promptOptimizer/PromptOptimizerService.ts` — interfaccia + implementazione
- [ ] `apps/api/src/application/llm/promptOptimizer/OptimizerContextBuilder.ts` — risolve contesto da profilo + moodboard
- [ ] `apps/api/src/application/llm/promptOptimizer/OptimizerSystemInstruction.ts` — template Nunjucks + renderer
- [ ] `apps/api/src/application/llm/promptOptimizer/OptimizerAttachmentProcessor.ts` — estrazione testo + vision

### R0.2 — Route API

- [ ] `apps/api/src/presentation/http/routes/optimizePromptRoutes.ts` — route POST con sandbox middleware
- [ ] Registrazione route in `app.ts` sotto `/v1/projects/:id/llm/`
- [ ] Rate limiter: 10 req/ore/utente su Redis (key: `optimizer:{userId}:hour`)

### R0.3 — Risoluzione Modello

- [ ] `apps/api/src/application/llm/promptOptimizer/OptimizerModelResolver.ts`:
  - Legge `LLM_OPTIMIZER_MODEL_ID` da env
  - Fallback su `project.aiConfig.modelId`
  - Fallback su catalog default
- [ ] Aggiunte a `.env.example` e `.env.docker`: `LLM_OPTIMIZER_MODEL_ID=`

### R0.4 — Frontend: Bottone "Ottimizza Prompt"

- [ ] Aggiungere `optimizePrompt(projectId, body)` in `apps/web/lib/api.ts`
- [ ] Componente `PromptOptimizerButton.tsx` in `apps/web/components/`:
  - Visibility logic: appare dopo 10+ char in textarea o se allegati presenti
  - Loading state con spinner
  - Undo buffer per ripristino originale (5 secondi)
- [ ] Integrazione nel `WorkspaceChat` component (chat input area)
- [ ] Toast di errore on failure

### R0.5 — Frontend: Feedback Visivo

- [ ] Indicatore "prompt ottimizzato" nella textarea (es. badge `AI ✨`)
- [ ] Diff highlight opzionale (mostra cosa è stato modificato) — nice-to-have, non bloccante
- [ ] Tooltip sul bottone: "Arricchisci il tuo prompt con AI usando il contesto del progetto"

### R0.6 — Env e Config

- [ ] `LLM_OPTIMIZER_MODEL_ID` in `.env.example` e `.env.docker` (empty = usa model di progetto)
- [ ] `LLM_OPTIMIZER_RATE_LIMIT_PER_HOUR` in `.env.example` (default: 10)

---

## 9. Testable Steps

```
Test 1 — Backend base (senza attachments, senza profilo)
  POST /v1/projects/:id/llm/optimize-prompt
  body: { rawPrompt: "voglio un sito per il mio ristorante" }
  → 200 OK, enhancedPrompt contiene obiettivo + sezioni + media suggeriti
  → enhancedPrompt NON contiene parole "HTML", "CSS", "Tailwind", "div", "section"

Test 2 — Contesto profilo utente
  Utente con sectorTags: ["sector:food-beverage"], toneTags: ["tone:friendly-casual"]
  → enhancedPrompt riflette settore food e tono friendly
  → "pizzeria", "osteria", "trattoria" appare naturalmente se nel profilo

Test 3 — Contesto moodboard progetto
  ProjectMoodboard con brief: "Studio fotografico di moda"
  → enhancedPrompt menziona portfolio, galleria, shooting, clienti fashion
  → override su identità utente generica

Test 4 — Allegato PDF
  Allegato: menu.pdf con antipasti, primi, secondi
  → enhancedPrompt include istruzioni su presentare il menù con sezioni reali
  → Non copia verbatim il PDF, ma estrae struttura

Test 5 — Allegato immagine (vision disponibile)
  Allegato: logo.jpg + interior.jpg
  → enhancedPrompt menziona di usare le immagini allegate per hero e gallery

Test 6 — Nessun modello vision disponibile
  Modello ottimizzatore senza vision
  → Processo non fallisce — skip descrizione immagine, usa solo filename

Test 7 — Sandbox check
  JWT di utente_B → /v1/projects/:id (owned by utente_A)
  → 403 Forbidden

Test 8 — Rate limit
  11 chiamate in 1 ora dallo stesso utente
  → 429 Too Many Requests alla chiamata 11

Test 9 — Integration flow completo
  Usa enhancedPrompt come input → invia chat-preview → verifica che Layer A-D
  si componga correttamente (nessun conflitto tra prompt ottimizzato e system prompt)

Test 10 — Frontend: undo
  Ottimizza → textarea aggiornata → clicca "Ripristina" entro 5 secondi
  → textarea torna al testo originale
```

---

## 10. Domande Aperte e Decisioni Future

| Domanda | Default suggerito | Note |
|---|---|---|
| Il prompt ottimizzato va salvato come snapshot separato? | No (solo metadata del messaggio) | Aggiunge complessità senza valore immediato |
| L'utente può vedere la chiamata costare crediti? | No per ora (R0) | In M5 (Credit System) si può decidere un costo ridotto o zero |
| Il bottone deve essere presente nel Refine mode (non solo prima generazione)? | Sì, anche in refine | L'utente può ottimizzare anche modifiche successive |
| Gestire rate limit per piano commerciale free vs pro? | In M5 con Credit System | Per R0: rate limit flat per tutti |
| Supportare streaming del prompt ottimizzato (effetto typing)? | Nice-to-have R0.5 | Migliora UX ma non bloccante per rilascio |
| Il modello optimizer può essere configurato per-progetto (non solo env)? | Roadmap futura | Aggiungere a `project.aiConfig` in milestone successiva |

---

## 11. Note di Integrazione nella Pipeline Prompt

Riepilogo del flusso completo con R0 integrato:

```
User input area
  │
  ├─ rawPrompt (opzionale: 1 char min)
  ├─ attachments (opzionale)
  └─ [✨ Ottimizza Prompt] → PromptOptimizerService → enhancedPrompt
                                 └─ legge: UserStyleProfile
                                          ProjectMoodboard
                                          Allegati (PDF text + image desc)
  │
  ▼
enhancedPrompt → messaggio utente → Chat Preview API
                                         │
                              System Message composto da:
                              [Layer A: vincoli architetturali]
                              [Layer B: preset output spec]
                              [Layer C: style context block]
                              [Layer D: prePromptTemplate]
                                         │
                                         ▼
                                    LLM generatore
                                    → HTML + CSS + JS
```

Il Prompt Optimizer è un **acceleratore di qualità contenutistica** che si inserisce come step opzionale tra il pensiero dell'utente e la generazione tecnica, senza accoppiamento forte con nessun altro componente del sistema.
