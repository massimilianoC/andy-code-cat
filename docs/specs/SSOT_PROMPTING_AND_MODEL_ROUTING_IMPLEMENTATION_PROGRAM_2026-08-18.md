# Programma Unificato SSOT — Prompt Execution, Model Routing e Feedback UI

> **Superseded by [../SSOT_STATUS.md](../SSOT_STATUS.md) (2026-08-31).** `U0`–`U5` are executed
> except the PromptExecution↔run linkage in §3. This document is no longer the implementation
> authority; keep it for the design rationale only.

**Stato:** priorità immediata di implementazione e review  
**Data:** 2026-08-18  
**Decisione:** questo documento unifica e ordina i due refactor attivi: [Prompt Execution SSOT](PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md) e [Vibe → GodMode Model SSOT](VIBE_TO_GODMODE_MODEL_SSOT_REGRESSION_ANALYSIS_2026-08-18.md). Per l’implementazione prevale su piani precedenti in conflitto riguardo orchestrazione, fallback, optimizer implicito, handoff browser-owned e modello di pipeline.

---

## 1. Outcome unico

Il prodotto deve rendere vera e dimostrabile una sola catena:

    intento e override utente
      → PipelineRun server-owned
      → decisione modello centralizzata
      → brief canonico immutabile
      → PromptExecution immutabile
      → provider dispatch
      → messaggio, snapshot, costi e Workshop UI

Le due leggi SSOT sono inseparabili:

1. **Execution SSOT:** ciò che Workshop mostra è il payload safe realmente risolto e inviato dal server.
2. **Model SSOT:** il modello manualmente selezionato dall’utente vince sempre per il run; nessun task, fallback, preset, query o storage browser può sostituirlo in silenzio.

PipelineRun e PromptExecution sono aggregate distinti ma correlati: il primo governa intento, lock, brief e stato; il secondo è la prova immutabile di ciascun dispatch LLM. Un costo, un badge o un default amministrativo non sono prova della generazione finale.

## 2. Decisioni vincolanti

### 2.1 Precedenza unica di selezione LLM

| Priorità | Fonte | Regola |
| --- | --- | --- |
| 1 | override manuale dell’utente confermato al submit | crea PipelineRun.modelLock; prevale sempre |
| 2 | eccezione di capacità esplicitamente confermata | solo se il lock non svolge una capacità dichiarata; visibile e auditata |
| 3 | policy/configurazione amministrativa per task | default per un **nuovo run senza override**; non riscrive un lock |
| 4 | catalogo runtime e ruolo/capability | propone e valida il modello prima della creazione del run |

Il backend rifiuta (409/422) un dispatch diverso dal lock. Se il modello lockato è indisponibile, il run entra in blocked: non cade su DeepSeek, MiniMax o altro default.

### 2.2 Un solo resolver applicativo

Introdurre ResolveModelSelectionDecision con due modalità:

- createRun: valida l’override manuale oppure risolve un default amministrativo e congela decisione, catalog revision e motivazione.
- dispatchRun: legge esclusivamente la decisione immutabile del run, valida disponibilità/capacità e produce provider/model effettivi oppure un errore fail-closed.

Route handler, optimizer, Vibe, Zero Effort e chat-preview non implementano una propria cascata. La UI invia una proposta per creare un run, mai una coppia autoritativa per alterarne uno esistente.

### 2.3 Brief e policy di ottimizzazione

BuildCanonicalGenerationBrief nell’application layer produce una BriefRevision server-owned: testo, schema version, hash e provenienza. È l’unico messaggio user per il launch automatico GodMode.

Vibe → Zero Effort → GodMode imposta optimizationPolicy: skip. System prompt e guideline sono composti al dispatch, ma il brief non è riscritto. L’optimizer resta disponibile solo come comando esplicito e crea una nuova revisione/run con relazione di derivazione.

## 3. Contratti minimi e ownership Clean Architecture

packages/contracts è l’autorità condivisa per le forme pubbliche. Il dominio non dipende da provider, route o UI.

    ModelSelectionDecision
      - requested: provider, model, source, catalog revision
      - effective: provider, model
      - policy: strict | allow-explicit-capability-exception
      - outcome: exact | explicit-exception | blocked
      - exception: motivazione e approvazione, se presente

    BriefRevision
      - content, schema version, content hash, provenance

Responsabilità:

- **domain:** invarianti di lock/revisioni/stati e repository interface;
- **application:** creazione run, brief, risoluzione modello, dispatch e policy optimizer;
- **infra:** catalogo/provider adapter, Mongo e costi;
- **presentation:** contratti, double sandbox e read model. Nessuna composizione brief o fallback decisionale.

Ogni PromptExecution conserva pipelineRunId, stage, snapshot requested/effective della decisione, canonicalBriefHash, payloadHash, executionId, link a messaggio/snapshot/costo/notifica.

## 4. Feedback utente obbligatorio

Il picker espone un ModelDecisionView server-derived:

| Stato UI | Contenuto minimo | Azione |
| --- | --- | --- |
| Prima dell’avvio | richiesto, disponibilità, lock strict, capability/stima | conferma o cambia |
| In esecuzione | stage, modello effettivo, brief hash, optimizer skipped | osserva/cancella |
| Bloccato | modello richiesto e causa, nessun dispatch alternativo | cambia modello o approva eccezione |
| Eccezione | richiesto/effettivo, stage, motivazione e approvazione | consenso esplicito |
| Completato | modello snapshot, Prompt tab e costi per stage | apre prova |

Le notifiche sono eventi persistiti del run, non toast dedotti dal client: MODEL_LOCKED, MODEL_UNAVAILABLE, CAPABILITY_EXCEPTION_REQUIRED, OPTIMIZATION_SKIPPED, BRIEF_REVISION_DISPATCHED, ARTIFACT_GENERATED.

## 5. Sequenza di implementazione e review

### U0 — Governance e baseline

- ADR unico per lifecycle, idempotenza, hash, retention, redazioni e policy modello.
- Matrice documentale active / implemented / deferred / historical.
- Fixture congelate per Vibe, prefill, GodMode, stream, focused edit e asset.

**Gate:** nessun documento attivo autorizza optimizer implicito, fallback silenzioso o autorità browser.

### U1 — Dominio e contratti condivisi

- Contratti PipelineRun, ModelSelectionDecision, CanonicalBriefEnvelope, PromptExecution e DTO UI.
- PipelineStageExecutionRef per gli stage LLM punta al PromptExecution, senza un secondo journal concorrente.
- Compatibilità additiva per dati legacy, sempre etichettati non verificati.

**Gate:** API e web usano un solo vocabolario contrattuale.

### U2 — Risoluzione modello server-side unica

- Estrarre ResolveModelSelectionDecision.
- Convergere Vibe, Zero Effort, optimizer e GodMode sul resolver.
- Bloccare prima del dispatch quando il lock non è soddisfatto.
- Rimuovere come autorità preferredProvider, preferredModel, query, localStorage e selettori locali.

**Gate:** Kimi selezionato resta Kimi in ogni stage; Kimi assente genera zero chiamate alternative.

### U3 — Run e brief canonico

- Persistire il run al primo submit ed estrarre BuildCanonicalGenerationBrief.
- Passare a GodMode solo pipelineRunId.
- optimizationPolicy: skip per il percorso richiesto e endpoint server-owned launch-godmode.

**Gate:** brief.contentHash coincide con dispatchedUserMessageHash; nessun optimizer nel run skip.

### U4 — Prompt execution e journal durevole

- Estrarre ResolvePromptExecution dalla route.
- Persistire server-side resolved → dispatched → terminal.
- Collegare execution a run, messaggio, snapshot, log e costo; introdurre idempotency key.

**Gate:** refresh/disconnessione non perde la prova; retry non duplica invii.

### U5 — UI, notifiche e review E2E

- Workshop mostra payload ordinato, layer, brief revision e requested/effective model del snapshot selezionato.
- Costi raggruppati per pipelineRunId e stage.
- Docker E2E: Vibe → prefill → brief → GodMode → snapshot → Prompt tab → costi/notifiche.

**Gate:** UI e notifiche derivano esclusivamente dal read model server-side.

## 6. Ordine di roadmap

1. U0–U3: prossimo lavoro di implementazione.
2. U4–U5: completamento del gate R2/R3.
3. Solo dopo: Layer S, nuove capability, BaaS, RAG, Gen AI Media, workflow/node editor, Curiosity/Nerdy e automazioni speculative.

R3 publish hardening non è annullato, ma nessun ampliamento del prompting o nuovo entry flow passa prima dei gate U2–U5.

## 7. Disposizione delle specifiche

| Documento | Nuovo stato |
| --- | --- |
| PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md | attivo: prova/payload/Workshop |
| VIBE_TO_GODMODE_MODEL_SSOT_REGRESSION_ANALYSIS_2026-08-18.md | attivo: lock/brief/direct handoff |
| questo programma | autorità di ordinamento e review |
| ZERO_EFFORT_PREFILL_SPEC.md | implemented baseline, parzialmente sostituito per storage/handoff/fallback |
| PROMPT_OPTIMIZER_SPEC.md | attivo solo per ottimizzazione esplicita |
| PROMPTING_SERVICE_PLATFORM_SPEC.md | governance reference; default validi solo senza lock |
| MULTIMODE_UX_MVP_EXECUTION_SPEC.md | storico: visione utile, delivery sequence superata |
| DASHBOARD_LOVABLE_CHAT_SPEC.md | storico: UX/design reference |
| MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md | storico: playbook generico |
| WORKFLOW_PIPELINE_MODULARIZATION_PLAN.md | futuro differito, non autorità P0 |

## 8. Criterio di uscita

Una E2E ripetibile, sullo stesso pipelineRunId, deve dimostrare: override Kimi K3 lockato; stesso modello per ogni stage testuale o eccezione approvata; brief hash invariato; nessuna ottimizzazione implicita nel percorso skip; snapshot/costi/Prompt tab collegati al dispatch; feedback comprensibile per successo, blocco ed eccezione.

Fino a quel punto, ogni feature che aggiunge un resolver LLM, fallback, storage browser del prompt o nuovo handoff viene respinta in review per violazione SSOT/Clean Architecture.
