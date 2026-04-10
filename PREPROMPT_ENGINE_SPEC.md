# Andy Code Cat — PrepromptEngine: Specifiche Dettagliate

> **Scope:** Specifiche tecniche complete del servizio PrepromptEngine  
> **Dipendenze:** MongoDB (PrepromptProfile), Nunjucks (template), pdf-parse, Sharp  
> **Posizione nel progetto:** `apps/api/src/services/preprompt/`

---

## 1. Responsabilità

Il PrepromptEngine è il servizio che trasforma un **input grezzo** (prompt testuale, PDF, immagine) in un **prompt strutturato e arricchito** pronto per essere passato a OpenCode.

Produce tre output distinti per ogni job:

| Output | Descrizione | Usato da |
|---|---|---|
| `resolvedPrompt` | Prompt finale arricchito e wrappato | OpenCode CLI (argomento) |
| `resolvedClaudeMd` | Contenuto del CLAUDE.md di progetto | Scritto in working dir |
| `resolvedOpenCodeJson` | Config opencode.json per il job | Scritto in working dir |

---

## 2. Architettura Interna

```
PrepromptEngine
│
├── InputProcessor           — normalizza input eterogenei
│   ├── TextExtractor        — estrae testo da PDF
│   ├── ImageDescriber       — descrive immagini via LLM vision
│   └── AttachmentSanitizer  — valida tipo/dimensione allegati
│
├── ContextBuilder           — costruisce il contesto del job
│   ├── ProjectContextLoader — carica dati progetto da DB
│   ├── IterationContext     — carica manifest/summary iterazione prec.
│   └── ThemeResolver        — risolve override tema se presenti
│
├── LayerComposer            — applica i layer del profilo in ordine
│   ├── TemplateRenderer     — Nunjucks rendering variabili
│   ├── ConditionEvaluator   — valuta condizioni JSONata sui layer
│   └── LayerMerger          — concatena layer nel prompt finale
│
├── ClaudeMdGenerator        — genera il CLAUDE.md per la sessione
│   └── SkillsInjector       — copia skill files nella working dir
│
└── OpenCodeConfigGenerator  — genera opencode.json dinamico
    └── ProviderResolver     — risolve API key per il provider scelto
```

---

## 3. Flusso di Esecuzione

```typescript
// Interfaccia pubblica del servizio
interface PrepromptEngine {
  process(input: PrepromptInput): Promise<PrepromptOutput>;
  previewResolution(input: PrepromptInput): Promise<PrepromptPreview>;
}

interface PrepromptInput {
  job: Job;                          // job MongoDB con attachments
  project: Project;                  // progetto con aiConfig
  prepromptProfile: PrepromptProfile; // profilo selezionato
  workspaceDir: string;              // path working directory del job
}

interface PrepromptOutput {
  resolvedPrompt: string;            // prompt da passare a OpenCode CLI
  resolvedClaudeMd: string;          // contenuto CLAUDE.md
  resolvedOpenCodeJson: object;      // oggetto config opencode
  imagesToProcess: string[];         // path immagini allegate per vision
  debugInfo: {                       // per audit/logging
    layersApplied: string[];
    variablesResolved: Record<string, string>;
    attachmentsSummary: string;
    processingTimeMs: number;
  };
}
```

### 3.1 Step 1 — Input Processing

```typescript
class InputProcessor {
  async process(job: Job): Promise<ProcessedInput> {
    const results: ProcessedInput = {
      rawPrompt: job.input.prompt ?? '',
      extractedTexts: [],
      imageDescriptions: [],
      sanitizedAttachments: []
    };

    for (const attachment of job.input.attachments ?? []) {
      switch (attachment.mimeType) {

        case 'application/pdf':
          // Estrae testo con pdf-parse
          // Max 50.000 char estratti (troncato con nota se oltre)
          // Preserva struttura: headers, bullet, tabelle come testo
          const text = await this.textExtractor.extract(attachment.filePath);
          results.extractedTexts.push({
            filename: attachment.originalName,
            content: text.slice(0, 50000),
            truncated: text.length > 50000
          });
          break;

        case 'image/jpeg':
        case 'image/png':
        case 'image/webp':
          // Se il modello del progetto supporta vision:
          //   → chiama LLM con l'immagine e prompt: "Descrivi questo contenuto
          //     in modo dettagliato per usarlo come contesto per generare
          //     un sito web. Includi: testo visibile, struttura layout,
          //     colori principali, elementi grafici, tone of voice percepito."
          // Se il modello NON supporta vision:
          //   → usa filename e EXIF data come contesto minimale
          const description = await this.imageDescriber.describe(
            attachment.filePath,
            project.aiConfig
          );
          results.imageDescriptions.push({
            filename: attachment.originalName,
            description
          });
          break;
      }
    }

    return results;
  }
}
```

### 3.2 Step 2 — Context Building

Il ContextBuilder assembla un oggetto `TemplateContext` usato da Nunjucks:

```typescript
interface TemplateContext {
  project: {
    name: string;
    slug: string;
    type: string;            // landing_page | mini_site | ecc.
    description?: string;
    lang: string;            // it | en | ecc.
  };
  
  input: {
    prompt: string;          // prompt raw dell'utente
    attachments: {
      hasAttachments: boolean;
      pdfs: Array<{ filename: string; content: string; truncated: boolean }>;
      images: Array<{ filename: string; description: string }>;
      summary: string;       // testo aggregato di tutti gli allegati
    };
  };
  
  deployment: {
    domain: string;          // es. myclient.Andy Code Cat.io
    mode: string;            // subdomain | custom_domain | zip_export
    baseUrl: string;         // https://myclient.Andy Code Cat.io
  };
  
  iteration: {
    number: number;          // 1 per prima gen, 2+ per refine
    isFirstGeneration: boolean;
    previousManifest?: object; // MANIFEST.json ultima iterazione
    previousBuildNotes?: string;
    changesRequested?: string; // solo per refine: descrizione modifiche
  };
  
  theme: {
    primaryColor?: string;
    fontFamily?: string;
    borderRadius?: string;
    mood?: string;           // professional | playful | minimal | bold
    hasOverride: boolean;
  };
  
  meta: {
    jobId: string;
    timestamp: string;       // ISO datetime
    agentType: string;       // Andy Code Cat-builder | Andy Code Cat-refiner
    outputDir: string;       // path assoluto della working dir
  };
}
```

**Risoluzione contesto iterazione precedente:**

```typescript
async buildIterationContext(project: Project): Promise<IterationContext> {
  const lastJob = await Job.findOne({
    projectId: project._id,
    status: 'completed',
    type: { $in: ['generation', 'refinement'] }
  }).sort({ completedAt: -1 });

  if (!lastJob || !lastJob.output) {
    return { number: 1, isFirstGeneration: true };
  }

  // Leggi MANIFEST.json dall'ultimo output
  const manifestPath = path.join(lastJob.output.outputDir, 'dist', 'MANIFEST.json');
  const manifest = await fs.readJSON(manifestPath).catch(() => null);

  return {
    number: (project.iterationCount ?? 0) + 1,
    isFirstGeneration: false,
    previousManifest: manifest,
    previousBuildNotes: manifest?.buildNotes,
    previousGitCommit: lastJob.output.gitCommitHash
  };
}
```

### 3.3 Step 3 — Layer Composition

```typescript
class LayerComposer {
  async compose(
    layers: PrepromptLayer[],
    context: TemplateContext
  ): Promise<string> {
    
    // 1. Ordina layer per order ASC
    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    
    // 2. Filtra layer con condizioni false
    const activeLayers = await Promise.all(
      sortedLayers.map(async layer => {
        if (!layer.condition) return layer;
        const result = await this.conditionEvaluator.evaluate(
          layer.condition,
          context
        );
        return result ? layer : null;
      })
    ).then(layers => layers.filter(Boolean));

    // 3. Renderizza ogni layer con Nunjucks
    const renderedLayers = await Promise.all(
      activeLayers.map(async layer => {
        const rendered = await this.templateRenderer.render(
          layer.content,
          context
        );
        return {
          name: layer.name,
          type: layer.type,
          content: rendered
        };
      })
    );

    // 4. Concatena con separatori semantici
    return renderedLayers
      .map(layer => `## [${layer.type.toUpperCase()}] ${layer.name}\n\n${layer.content}`)
      .join('\n\n---\n\n');
  }
}
```

**Valutazione condizioni (JSONata):**

```typescript
// Esempio condizioni nei layer:
// "input.attachments.hasAttachments == true"
// "iteration.number > 1"
// "project.type == 'landing_page'"
// "theme.mood == 'playful'"

import jsonata from 'jsonata';

class ConditionEvaluator {
  async evaluate(condition: string, context: TemplateContext): Promise<boolean> {
    try {
      const expression = jsonata(condition);
      const result = await expression.evaluate(context);
      return Boolean(result);
    } catch (err) {
      // Condizione malformata → layer incluso per default (fail-open)
      logger.warn(`Condizione malformata nel layer: ${condition}`, err);
      return true;
    }
  }
}
```

### 3.4 Step 4 — Template Rendering

Nunjucks con custom filters:

```typescript
const nunjucksEnv = nunjucks.configure({ autoescape: false });

// Filter: tronca testo con ellipsis
nunjucksEnv.addFilter('truncate', (str: string, length: number) =>
  str.length > length ? str.slice(0, length) + '...' : str
);

// Filter: converte oggetto in JSON formattato
nunjucksEnv.addFilter('json', (obj: object) =>
  JSON.stringify(obj, null, 2)
);

// Filter: sanitizza per uso in prompt (rimuove caratteri problematici)
nunjucksEnv.addFilter('promptSafe', (str: string) =>
  str.replace(/[<>]/g, '').replace(/\n{3,}/g, '\n\n').trim()
);

// Filter: formatta lista come bullet points
nunjucksEnv.addFilter('bullets', (arr: string[]) =>
  arr.map(item => `- ${item}`).join('\n')
);
```

**Esempio template layer con tutti i filtri:**

```
{% if input.attachments.hasAttachments %}
## Contenuto allegati forniti dall'utente:

{% if input.attachments.pdfs.length > 0 %}
### Documenti PDF:
{% for pdf in input.attachments.pdfs %}
**{{ pdf.filename }}:**
{{ pdf.content | truncate(5000) | promptSafe }}
{% if pdf.truncated %}
[... contenuto troncato per lunghezza ...]
{% endif %}
{% endfor %}
{% endif %}

{% if input.attachments.images.length > 0 %}
### Immagini fornite:
{% for img in input.attachments.images %}
**{{ img.filename }}:** {{ img.description | promptSafe }}
{% endfor %}
{% endif %}

{% endif %}
```

### 3.5 Step 5 — CLAUDE.md Generation

Il CLAUDE.md viene generato dal template definito nel PrepromptProfile.  
È il documento di "briefing completo" che OpenCode legge all'inizio della sessione.

```typescript
// Template CLAUDE.md di default (sovrascrivibile per profilo)
const DEFAULT_CLAUDE_MD_TEMPLATE = `
# Andy Code Cat Project: {{ project.name }}

## Job Info
- Job ID: {{ meta.jobId }}
- Iterazione: {{ iteration.number }}
- Agente: {{ meta.agentType }}
- Timestamp: {{ meta.timestamp }}
- Output directory: {{ meta.outputDir }}/dist/

## Obiettivo
{{ prompt_section }}

## Deployment Target
- URL: {{ deployment.baseUrl }}
- Dominio: {{ deployment.domain }}
- Lingua sito: {{ project.lang }}

{% if theme.hasOverride %}
## Override Tema
- Colore primario: {{ theme.primaryColor }}
- Font: {{ theme.fontFamily }}
- Mood: {{ theme.mood }}
{% endif %}

{% if iteration.number > 1 %}
## Contesto Iterazione Precedente
Build notes precedente: {{ iteration.previousBuildNotes }}
Immagini placeholder già definite:
{% for img in iteration.previousManifest.imagePlaceholders %}
- {{ img.file }}: {{ img.description }}
{% endfor %}

{% if iteration.changesRequested %}
## Modifiche Richieste in Questa Iterazione
{{ iteration.changesRequested }}
{% endif %}
{% endif %}

## Regole Operative
Leggi e rispetta AGENTS.md per tutte le policy tecniche.
Crea dist/MANIFEST.json al termine. Non chiedere conferme.
`;
```

### 3.6 Step 6 — OpenCode Config Generation

```typescript
function generateOpenCodeConfig(
  project: Project,
  profile: PrepromptProfile,
  resolvedApiKey: string
): object {
  return {
    "$schema": "https://opencode.ai/config.json",
    "model": `${project.aiConfig.provider}/${project.aiConfig.model}`,
    
    "provider": {
      [project.aiConfig.provider]: {
        "npm": resolveProviderNpm(project.aiConfig.provider),
        "options": {
          "baseURL": resolveBaseUrl(project.aiConfig.provider),
          "apiKey": resolvedApiKey
        }
      }
    },
    
    // Override da progetto (es. temperature, max_tokens)
    ...project.aiConfig.openCodeConfigOverride,
    
    "agents": {
      [profile.openCodeConfig.agentProfile ?? 'Andy Code Cat-builder']: {
        "tools": profile.openCodeConfig.allowedTools ?? [
          "Read", "Write", "Edit", "Bash", "Glob", "Grep"
        ]
      }
    }
  };
}

// Mapping provider → npm package
function resolveProviderNpm(provider: string): string {
  const map: Record<string, string> = {
    'anthropic': '@ai-sdk/anthropic',
    'openai': '@ai-sdk/openai',
    'google': '@ai-sdk/google',
    'ollama': '@ai-sdk/openai-compatible',
    'openrouter': '@ai-sdk/openai-compatible',
  };
  return map[provider] ?? '@ai-sdk/openai-compatible';
}
```

---

## 4. Profili Preprompt — Struttura Completa

### 4.1 Profilo di Default: `landing-page-standard`

```json
{
  "_id": "...",
  "name": "Landing Page — Standard",
  "description": "Profilo generico per landing page B2C/B2B. Produce siti moderni, professionali, ottimizzati per conversioni.",
  "version": "1.0.0",
  "scope": {
    "type": "agent_type",
    "agentType": "landing_page"
  },
  "layers": [
    {
      "order": 1,
      "name": "Identità Agente",
      "type": "system",
      "isOptional": false,
      "condition": null,
      "content": "Sei Andy Code Cat Builder, un agente specializzato nella creazione di landing page web ad alta conversione. Produci sempre codice HTML/CSS/JS completo, funzionante e pronto per la pubblicazione. Il tuo output va nella cartella dist/. Non chiedere mai conferme."
    },
    {
      "order": 2,
      "name": "Contesto Progetto",
      "type": "context",
      "isOptional": false,
      "condition": null,
      "content": "Progetto: {{ project.name }} ({{ project.type }})\nDominio di pubblicazione: {{ deployment.domain }}\nLingua: {{ project.lang }}\nIterazione: {{ iteration.number }}"
    },
    {
      "order": 3,
      "name": "Contenuto Allegati",
      "type": "context",
      "isOptional": true,
      "condition": "input.attachments.hasAttachments == true",
      "content": "## Materiale fornito dall'utente:\n{% for pdf in input.attachments.pdfs %}\n### {{ pdf.filename }}\n{{ pdf.content | truncate(8000) | promptSafe }}\n{% endfor %}\n{% for img in input.attachments.images %}\n### Immagine: {{ img.filename }}\n{{ img.description | promptSafe }}\n{% endfor %}"
    },
    {
      "order": 4,
      "name": "Override Tema",
      "type": "context",
      "isOptional": true,
      "condition": "theme.hasOverride == true",
      "content": "## Stile visivo richiesto:\n- Colore primario: {{ theme.primaryColor }}\n- Font: {{ theme.fontFamily }}\n- Mood: {{ theme.mood }}\nRifletti queste scelte nelle CSS Custom Properties."
    },
    {
      "order": 5,
      "name": "Richiesta Utente",
      "type": "context",
      "isOptional": false,
      "condition": null,
      "content": "## Richiesta:\n{{ input.prompt | promptSafe }}"
    },
    {
      "order": 6,
      "name": "Vincoli Tecnici",
      "type": "constraint",
      "isOptional": false,
      "condition": null,
      "content": "## Vincoli ASSOLUTI:\n1. Output solo in dist/ (struttura: index.html, css/style.css, js/main.js, images/)\n2. Nessun framework JS (React, Vue, ecc.) — HTML/CSS/JS vanilla\n3. Nessun CDN tranne Google Fonts\n4. Mobile-first responsive\n5. Ogni immagine mancante → placeholder con pattern IMAGE_PLACEHOLDER\n6. CSS Custom Properties obbligatorie per il tema\n7. HTML semantico con meta SEO completi"
    },
    {
      "order": 7,
      "name": "Formato Output",
      "type": "format",
      "isOptional": false,
      "condition": null,
      "content": "## Output richiesto:\nAl termine della generazione, DEVI creare dist/MANIFEST.json con struttura definita in AGENTS.md. Questo è OBBLIGATORIO. Il sistema usa questo file per post-processing."
    }
  ],
  "openCodeConfig": {
    "agentProfile": "Andy Code Cat-builder",
    "skills": ["no-confirm", "static-site-best-practices", "placeholder-images", "manifest-required"],
    "claudeMdTemplate": "default",
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
  },
  "outputStructure": {
    "expectedDirs": ["dist/", "dist/css/", "dist/images/"],
    "entryPoint": "dist/index.html",
    "imagePlaceholderPattern": "IMAGE_PLACEHOLDER:",
    "imageDir": "dist/images/"
  }
}
```

### 4.2 Profilo: `mini-site-portfolio`

Variante del profilo standard con layer aggiuntivi per portfolio multi-pagina:

```json
{
  "name": "Mini-Site Portfolio",
  "version": "1.0.0",
  "scope": { "type": "agent_type", "agentType": "portfolio" },
  "layers": [
    "... (layer 1-4 identici al profilo standard) ...",
    {
      "order": 5,
      "name": "Struttura Multi-Page",
      "type": "constraint",
      "isOptional": false,
      "condition": null,
      "content": "Genera un mini-sito di 3 pagine:\n1. index.html — Home/About\n2. work.html — Portfolio/Progetti\n3. contact.html — Contatti\n\nNavigation: menu sticky con link a tutte e 3 le pagine.\nOgni pagina deve essere stand-alone (include header e footer)."
    }
    "... (layer 6-7 identici al profilo standard) ..."
  ]
}
```

### 4.3 Profilo: `refine-standard`

Profilo specifico per iterazioni di raffinamento:

```json
{
  "name": "Refinement — Standard",
  "version": "1.0.0",
  "scope": { "type": "agent_type", "agentType": "refine" },
  "layers": [
    {
      "order": 1,
      "name": "Identità Agente Refiner",
      "type": "system",
      "content": "Sei Andy Code Cat Refiner. Stai modificando un sito web già esistente. Leggi i file in dist/ prima di modificare. Applica SOLO le modifiche richieste. Non stravolgere il design esistente."
    },
    {
      "order": 2,
      "name": "Contesto Iterazione",
      "type": "context",
      "condition": "iteration.number > 1",
      "content": "Sito esistente — iterazione {{ iteration.number - 1 }}:\nBuild notes: {{ iteration.previousBuildNotes }}\n\nFile già presenti in dist/ — leggili prima di modificare."
    },
    {
      "order": 3,
      "name": "Modifica Richiesta",
      "type": "context",
      "content": "## Modifica da applicare:\n{{ input.prompt | promptSafe }}"
    },
    {
      "order": 4,
      "name": "Vincoli Refine",
      "type": "constraint",
      "content": "VINCOLI:\n1. Mantieni lo stile visivo esistente\n2. Non toccare file non menzionati nella richiesta (a meno che strettamente necessario)\n3. Aggiorna MANIFEST.json con le modifiche\n4. Non chiedere conferme"
    }
  ]
}
```

---

## 5. Versioning Profili

### 5.1 Regole Bump Versione

| Tipo modifica | Bump | Esempio |
|---|---|---|
| Aggiunta layer opzionale | patch | 1.0.0 → 1.0.1 |
| Modifica testo layer esistente | patch | 1.0.1 → 1.0.2 |
| Aggiunta layer obbligatorio | minor | 1.0.2 → 1.1.0 |
| Rimozione layer | minor | 1.1.0 → 1.2.0 |
| Cambio struttura output attesa | major | 1.2.0 → 2.0.0 |
| Cambio openCodeConfig.agentProfile | major | 2.0.0 → 3.0.0 |

### 5.2 Storage Versioni

Ogni PUT su un profilo **non sovrascrive** — crea un nuovo documento con:

- Stessa `_id` logica (tracked via campo `profileGroupId`)
- `version` incrementata secondo regole bump
- `supersedes: previousDocId`
- `isActive: true` (la versione precedente passa a `isActive: false`)

I progetti referenziano sia `prepromptProfileId` (versione specifica) che `prepromptProfileGroupId` (per "aggiorna sempre all'ultima versione").

### 5.3 API Versioning

```
GET /api/v1/preprompt-profiles/:groupId/history
→ [
    { version: "1.0.0", createdAt: "...", isActive: false, _id: "..." },
    { version: "1.0.1", createdAt: "...", isActive: false, _id: "..." },
    { version: "1.1.0", createdAt: "...", isActive: true,  _id: "..." }  ← current
  ]

POST /api/v1/projects/:slug/use-profile-version
Body: { profileId: "specific-version-id" }
→ Il progetto userà sempre quella versione specifica, ignorando aggiornamenti futuri
```

---

## 6. Preview e Debug

### 6.1 Endpoint Preview

```
POST /api/v1/preprompt-profiles/:id/test
Body: {
  samplePrompt: "Landing page per una startup fintech chiamata PayFlow",
  projectContext: {
    name: "PayFlow",
    type: "landing_page",
    lang: "it",
    deployment: { domain: "payflow.Andy Code Cat.io" }
  },
  attachments: []  // opzionale: allegati di test
}

Response: {
  resolvedPrompt: "## [SYSTEM] Identità Agente\n\nSei Andy Code Cat Builder...",
  resolvedClaudeMd: "# Andy Code Cat Project: PayFlow\n...",
  resolvedOpenCodeJson: { ... },
  layersApplied: [
    { name: "Identità Agente", type: "system", included: true },
    { name: "Contenuto Allegati", type: "context", included: false, reason: "condizione falsa: hasAttachments == false" }
  ],
  estimatedTokens: 1250,
  warnings: []
}
```

### 6.2 Debug Logging

Ogni job salva in MongoDB il `debugInfo` della risoluzione:

```typescript
job.input.resolvedPrompt = output.resolvedPrompt;  // full text
job.input.debugInfo = {
  layersApplied: output.debugInfo.layersApplied,
  variablesResolved: output.debugInfo.variablesResolved,
  attachmentsSummary: output.debugInfo.attachmentsSummary,
  processingTimeMs: output.debugInfo.processingTimeMs,
  profileVersion: profile.version,
  profileId: profile._id.toString()
};
```

---

## 7. Gestione Errori

| Errore | Comportamento |
|---|---|
| Template Nunjucks malformato | Log errore, usa layer senza rendering variabili (fail-safe) |
| PDF non leggibile | Salta allegato, aggiunge warning al debugInfo |
| Immagine non leggibile da vision | Usa filename come descrizione fallback |
| Condizione JSONata invalida | Layer incluso per default (fail-open), warning loggato |
| Profile non trovato | Fallback al profilo default del sistema (`landing-page-standard`) |
| Template CLAUDE.md non trovato | Usa DEFAULT_CLAUDE_MD_TEMPLATE hardcoded |
| resolvedPrompt > 100.000 char | Tronca allegati PDF, mantiene prompt utente integro |

---

## 8. Test Cases

### 8.1 Unit Tests — LayerComposer

```typescript
describe('LayerComposer', () => {
  test('applica layer in ordine corretto', async () => { ... });
  test('salta layer con condizione falsa', async () => { ... });
  test('include layer con condizione vera', async () => { ... });
  test('include layer optional con condizione non valutabile', async () => { ... });
  test('renderizza variabili Nunjucks correttamente', async () => { ... });
  test('gestisce template malformato senza crash', async () => { ... });
});
```

### 8.2 Integration Tests — PrepromptEngine.process()

```typescript
describe('PrepromptEngine', () => {
  test('produce resolvedPrompt non vuoto per input minimo', async () => { ... });
  test('include contenuto PDF estratto nel prompt', async () => { ... });
  test('genera CLAUDE.md con variabili risolte', async () => { ... });
  test('genera opencode.json con provider corretto', async () => { ... });
  test('fallback a profilo default se ID non trovato', async () => { ... });
  test('tronca PDF oltre 50.000 char con nota', async () => { ... });
});
```

### 8.3 E2E Test — Preview Endpoint

```typescript
// Test via API
POST /preprompt-profiles/{landingPageProfileId}/test
Body: { samplePrompt: "Sito per pizzeria napoletana", projectContext: {...} }
→ resolvedPrompt contiene "pizzeria" ✓
→ layersApplied.length === 7 ✓ (tutti i layer del profilo standard)
→ estimatedTokens < 4000 ✓
```
