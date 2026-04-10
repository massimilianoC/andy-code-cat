# Andy Code Cat — Pipeline Layers Architecture

## Overview

Il sistema Andy Code Cat usa **due layer distinti** per la generazione di siti web.
Ogni layer è indipendente, testabile e collegato al successivo da un meccanismo di trigger esplicito.

---

## Layer 1 — Chat Preview

**Scopo:** iterazione rapida, feedback immediato, refinement testuale.

```
User message
    │
    ├─ + history (ultimi N turni user/assistant, budget 6000 token)
    ├─ + currentArtifacts (HTML/CSS/JS generati in precedenza)
    ├─ + focusContext (project | preview-element | code-selection)
    │
    ▼
LLM (SiliconFlow · dialogue model · streaming SSE)
    │
    ├─── event: thinking  → UI: testo fluente (last 600 chars)
    ├─── event: answer    → UI: draft box fisso (max 80px)
    └─── event: done      → result: LlmChatPreviewResult
                                │
                                ├─ structured.chat.summary  → chat bubble
                                ├─ structured.artifacts.html
                                ├─ structured.artifacts.css  → iframe preview
                                └─ structured.artifacts.js
                                │
                                └─ contextStats {
                                       estimatedTokens: number
                                       historyTurns: number
                                       atCapacity: boolean   ← trigger
                                   }
```

**Caratteristiche:**

- Sincrono dal punto di vista UX (risposta in ~5-30s)
- Nessun file su disco, tutto in-memory
- Persiste in Conversation.messages (MongoDB)
- Artifacts nell'iframe via `srcdoc` (no hosting)
- Focus contestuale su target specifico (elemento preview o porzione codice)

### Layer 1.5 — Focused Asset Control (estensione prioritaria)

Questa estensione rimane nel Layer 1 ma aggiunge controllo puntuale dell'asset da modificare.

```
Preview iframe
    │
    ├─ toggle Inspect ON/OFF
    ├─ hover highlight
    └─ click select element
             │
             ├─ copy node HTML
             ├─ copy metadata JSON
             └─ use in prompt
                    │
Code tabs (HTML/CSS/JS)
    │
    └─ line/range selection
             │
             ▼
focusContext injected into prompt wrapper
```

`focusContext` minimo consigliato:

```typescript
interface FocusContext {
    mode: 'project' | 'preview-element' | 'code-selection';
    targetType: 'html' | 'css' | 'js' | 'component' | 'section';
    selectedElement?: {
        stableNodeId: string;
        selector: string;
        tag: string;
        classes: string[];
        textSnippet?: string;
    };
    codeSelection?: {
        language: 'html' | 'css' | 'js';
        startLine: number;
        endLine: number;
        selectedText?: string;
    };
}
```

**Limiti:**

- Contesto massimo: ~6000 token (~24.000 chars)
- Output non deployabile direttamente (inline JSON, non file strutturati)
- Non adatto per siti con logica complessa o multi-file

---

## Transition Mechanism — Token Limit Trigger

Il trigger è **automatico** quando `contextStats.atCapacity === true` oppure **manuale** quando l'utente clicca "Avvia Pipeline Professionale".

```
Frontend riceve contextStats.atCapacity === true
    │
    ▼
Banner in chat:
"Il contesto è quasi saturo (N token / 6000).
Vuoi avviare la pipeline professionale per generare
i file definitivi del tuo sito?"
    │
    ├── [Continua nel chat]  → Layer 1 continua (context trimming automatico)
    └── [Avvia Pipeline]     → POST /v1/projects/:id/generate
                                  body: {
                                      conversationId,
                                      profileId,      // opz.
                                      fromChat: true  // porta artifacts attuali
                                  }
                                  → { jobId }
                                  → redirect /jobs/:jobId
```

**Dati trasferiti da Layer 1 a Layer 2:**

- `conversationId` — per estrarre storia e ultima richiesta
- `currentArtifacts` — HTML/CSS/JS come "iteration-0" di riferimento
- `conversationSummary` — riassunto della conversazione per il preprompt
- `focusContext` (quando presente) — scope dell'asset selezionato da preservare/ottimizzare

---

## Layer 2 — OpenCode Pipeline

**Scopo:** generazione professionale, file reali su filesystem, deploy su nginx.

```
POST /generate
    │
    ▼
Job { status: "queued" }
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    STAGE A — PrepromptEngine                 │
│                                                              │
│  Input: conversationId · userPrompt · profileId · attachments│
│                                                              │
│  LayerComposer (Nunjucks + JSONata)                         │
│    └─ layers: system · context · constraint · format · persona│
│                                                              │
│  Output: resolvedPrompt · CLAUDE.md · opencode.json          │
│  Cost: 0.5 crediti                                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   STAGE B — GenerationWorker                 │
│                                                              │
│  Workspace: /data/workspaces/{jobId}/                        │
│    ├── opencode.json                                         │
│    ├── CLAUDE.md                                             │
│    └── skills/                                               │
│                                                              │
│  spawn: opencode run --dangerously-skip-permissions          │
│    stdout → Job.logs[] + SSE stream                          │
│                                                              │
│  Post-processor: verifica dist/index.html                    │
│  Git: commit branch "iteration-N" su Gitea                   │
│  Cost: 5 crediti/iterazione                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │ (opzionale, Phase 2)    │
              ▼                         │
┌─────────────────────────┐             │
│  STAGE C — QualityCheck │             │
│                         │             │
│  Playwright screenshot  │  score≥75 → │
│  LLM vision score       │             │
│  se score<75: re-run B  │             │
│  Cost: 1.5 cred/ciclo   │             │
└───────────┬─────────────┘             │
            └───────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    STAGE D — DeployWorker                    │
│                                                              │
│  Copy: dist/ → /var/www/Andy Code Cat/{slug}/                    │
│  nginx.conf: template Nunjucks → sites-available/            │
│  nginx -t → rollback se KO                                   │
│  nginx reload (graceful)                                     │
│  Certbot SSL (prod) / http (dev)                             │
│  Cost: 1 credito                                             │
│                                                              │
│  Output: https://{slug}.Andy Code Cat.io                         │
└─────────────────────────────────────────────────────────────┘
```

**Job status lifecycle:**

```
queued → running → completed
                └→ failed (con retry automatico max 2)
```

**SSE events dal job:**

```typescript
type JobEvent =
    | { type: "stage_started";   stage: string; }
    | { type: "log";             stage: string; line: string; }
    | { type: "stage_completed"; stage: string; durationMs: number; }
    | { type: "stage_failed";    stage: string; error: string; }
    | { type: "credits_charged"; amount: number; balance: number; }
    | { type: "job_completed";   output: JobOutput; }
    | { type: "job_failed";      error: string; }
```

---

## Confronto dei due layer

| Aspetto | Layer 1 Chat Preview | Layer 2 OpenCode Pipeline |
|---|---|---|
| Latenza | 5-30s | 1-10 min |
| Output | JSON inline (HTML/CSS/JS string) | File reali su disco |
| Deploy | No (iframe srcdoc) | Sì (nginx serve) |
| Iterazioni | Tramite chat | Branch git iteration-N |
| Rollback | Storia conversazione | `POST /iterations/:n/restore` |
| Costo | ~0 (token LLM) | 5-8 crediti per run |
| Adatto per | Esplorazione, brief, mockup | Sito definitivo, produzione |
| Limite | 6000 token contesto | Nessun limite pratico |

---

## Configurazione pipeline per PrepromptProfile

Ogni profilo definisce quali stage attivare e i parametri per stage:

```typescript
interface PipelineConfig {
    stages: ('preprompt' | 'generation' | 'qualityCheck' | 'imageGen' | 'deploy')[];
    qualityCheck?: {
        enabled: boolean;
        minScore: number;       // default: 75
        maxRetries: number;     // default: 2
    };
    imageGen?: {
        enabled: boolean;
        mode: 'placeholder' | 'flux' | 'dalle';
    };
    deploy?: {
        autoPublish: boolean;   // se false, richiede conferma utente
        domain?: string;        // custom domain opzionale
    };
}

// MVP default:
const defaultPipeline: PipelineConfig = {
    stages: ['preprompt', 'generation', 'deploy'],
    qualityCheck: { enabled: false },
    imageGen: { enabled: false, mode: 'placeholder' },
    deploy: { autoPublish: false },
};
```

---

## Double Sandboxing (Layer 2)

Ogni workspace è isolato a due livelli:

```
Livello 1 — Tenant sandbox (utente)
    /data/workspaces/{jobId}/      ← workspace del singolo job
    /var/www/Andy Code Cat/{slug}/     ← webroot del progetto
    
    Isolamento: ogni job ha una directory dedicata
    Cleanup: workspace eliminato dopo N giorni (configurabile)

Livello 2 — Project sandbox (progetto)
    nginx: ogni subdomain serve solo il suo webroot
    crediti: addebitati per userId+projectId
    git: ogni progetto ha il suo repo Gitea privato
```

Questo modello rispecchia il `Tenant Isolation Model` definito in `AGENTS.md`.
