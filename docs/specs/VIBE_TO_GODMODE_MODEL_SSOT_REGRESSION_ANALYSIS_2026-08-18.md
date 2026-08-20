# Regressione Vibe → Zero Effort → GodMode — Model SSOT e Brief Canonico

**Stato:** analisi attiva e piano di correzione P0/P1 — nessuna implementazione è implicita  
**Data:** 2026-08-18  
**Autorità di pianificazione:** questa è la specifica vigente per la coerenza di modello, brief e handoff nel percorso Vibe → Zero Effort → GodMode. Integra [PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md](PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md), che rimane l’autorità per la tracciabilità dell’esecuzione e per la trasparenza Workshop.  
**Ambito:** VibeCore, prefill, Zero Effort, prompt optimizer, handoff automatico, Workspace/GodMode, catalogo provider/modelli, `PromptExecutionLog`, conversazioni, snapshot e costi.

---

## 1. Decisione di prodotto

Quando un utente sceglie un modello a partire da Vibe, quella scelta è un **vincolo di esecuzione della pipeline**, non un suggerimento visivo né una preferenza locale del browser.

> Un solo `PipelineRun` server-owned decide provider e modello. Ogni stadio testuale del run usa quella decisione; ogni eccezione di capacità è esplicita, autorizzata, registrata e visibile prima e dopo l’esecuzione. Non è ammesso alcun fallback silenzioso.

Per il passaggio **Vibe → Zero Effort → GodMode** richiesto, il comportamento target è:

```text
richiesta utente + modello selezionato
  → Vibe (classify/prefill con lo stesso modello)
  → brief canonico completo, persistito dal server
  → avvio diretto GodMode
  → system + guideline composti dal prompting system
  → brief canonico come messaggio user invariato
  → generazione artefatto con lo stesso modello
```

L’ottimizzazione è **saltata** in questo percorso. Non si riscrive il brief una seconda volta e non si esegue l’auto-optimizer del Workspace. Il briefing ricco prodotto in Zero Effort è il contributo utente autorevole per la generazione GodMode.

## 2. Evidenza della regressione locale

L’analisi è stata svolta in sola lettura sullo stack Docker locale già in esecuzione. Non sono stati riavviati né modificati servizi, database o configurazioni.

Per il progetto `GYRO Unicycles`, la cronologia effettiva di un singolo flusso mostra tre decisioni di modello:

| Stadio osservato | Provider effettivo | Modello effettivo | Evidenza persistita |
| --- | --- | --- | --- |
| `zero_effort_optimize` | OpenRouter | `moonshotai/kimi-k3` | `PromptExecutionLog` |
| `optimize_user_prompt` | SiliconFlow | `MiniMaxAI/MiniMax-M3` | messaggio conversazione e `PromptExecutionLog` |
| `chat` / artefatto finale | SiliconFlow | `deepseek-ai/DeepSeek-V3` | messaggio assistant, snapshot, `PromptExecutionLog` e log API |

Il log API del dispatch finale identifica esplicitamente `provider=siliconflow` e `model=deepseek-ai/DeepSeek-V3`. L’artefatto non è quindi una visualizzazione errata: è stato realmente generato da DeepSeek-V3. Il brief completo iniziale misurava circa 11.105 caratteri; `zero_effort_optimize` lo ha ridotto a circa 5.673 (-48,9%) prima del secondo optimizer. Il secondo tentativo MiniMax è terminato con `finishReason: length` ed è ripiegato sull’input: ha consumato risorse senza restituire il brief completo.

Il profilo costi che mostra Kimi e MiniMax descrive correttamente i rispettivi task eseguiti. Non prova, però, il modello dell’artefatto. Il difetto è che la UI e il modello dati non presentano tali esecuzioni come parti distinguibili dello stesso run, né espongono una decisione di modello coerente e verificabile.

## 3. Qual è oggi la source of truth?

Non esiste oggi una source of truth unica per il modello dell’intero flusso.

| Domanda | Fonte effettiva attuale | Limite |
| --- | --- | --- |
| Quale modello viene invocato in uno specifico task di background? | `promptTaskSettings` risolto da `PlatformConfig`, salvo override nel body | ogni task risolve autonomamente; non c’è un lock di pipeline |
| Quale modello genera il messaggio/artefatto in Workspace? | `provider` e `model` inviati dal browser; in assenza, catalogo runtime e fallback per ruolo | la scelta è browser-owned e può divergere dal task precedente |
| Quale modello ha effettivamente prodotto un artefatto già creato? | metadata immutabili del messaggio assistant e dello snapshot, più `PromptExecutionLog` | manca un collegamento unico di pipeline e una proiezione UI coerente |
| Quale modello è mostrato nei costi? | record di costo/esecuzione per singolo task | non è la verità dell’artefatto né della pipeline |

La gerarchia tecnica corrente è dunque frammentata: override del client, setting di task, catalogo/ruolo e fallback possono decidere indipendentemente. Nell’istanza locale analizzata non è presente una configurazione `PlatformConfig` persistita; perciò i default di codice (tra cui MiniMax per l’optimizer) sono effettivamente entrati in gioco. La regola “se seleziono Kimi 3, tutta la pipeline usa Kimi 3” non è esprimibile né verificabile nel modello attuale.

### Source of truth target

La nuova autorità deve essere un record immutabile e server-owned `PipelineRun` (o `ModelSelectionDecision` collegato a un run), creato al primo submit Vibe e referenziato da ogni esecuzione, messaggio e snapshot:

```ts
type PipelineModelLock = {
  policy: "strict" | "allow-explicit-capability-exception";
  requested: { providerId: string; modelId: string; catalogRevision: string };
  effective: { providerId: string; modelId: string };
  selectedAt: string;
  selectedBy: "user";
};

type PipelineRun = {
  id: string;
  projectId: string;
  ownerUserId: string;
  entryMode: "vibe" | "zero-effort" | "godmode";
  modelLock: PipelineModelLock;
  optimizationPolicy: "skip" | "explicit-user-request" | "enabled";
  canonicalBrief: { content: string; schemaVersion: string; hash: string; provenance: string[] };
  status: "draft" | "running" | "completed" | "failed" | "blocked";
};
```

`PipelineRun.modelLock` è la source of truth per la scelta di esecuzione futura. I metadata di messaggi, execution e snapshot rimangono la fonte di prova immutabile del risultato storico: devono sempre riportare `requested` ed `effective` e il relativo `pipelineRunId`.

## 4. Cause architetturali della regressione

Questa non è la colpa di un singolo provider né di un solo commit recente. È una regressione di
integrazione: l’optimizer obbligatorio, il routing tramite query, l’handoff con `sessionStorage` e
il brief ricco sono stati introdotti in momenti diversi. L’espansione del brief ha reso
inadeguata una riscrittura nata per un input più povero, senza riallineare il contratto end-to-end.
La correzione deve quindi ristabilire un’unica architettura, non cambiare soltanto il default di
un modello.

### P0 — tre resolver indipendenti e due proprietà del modello

VibeCore memorizza un override in `localStorage` e lo propaga nell’URL. Zero Effort usa quell’override oppure le configurazioni di task. Il Workspace riparte poi dalla propria coppia `selectedProvider` / `selectedModel`, inizializzata da catalogo, preset e parametri URL. Ogni punto dispone di una propria priorità e di proprie condizioni di validazione.

La chiamata finale `chat-preview` accetta la coppia inviata dal browser e può inviare quel modello direttamente a un provider OpenAI-compatible. È questa la decisione che ha prodotto DeepSeek-V3. Essa non è vincolata da `zero_effort_optimize` né da `vibe_mode_generate`.

In più, l’optimizer ha una regola diversa: considera il modello richiesto nel body soltanto per cataloghi `openai-compatible`. Questo gate esiste davvero (`OptimizeUserPrompt.ts`), ma **non spiega** l’incidente osservato: l’entry di catalogo di SiliconFlow — il provider effettivamente coinvolto nella sequenza Kimi → MiniMax → DeepSeek — ha essa stessa `apiType: "openai-compatible"` (vedi `defaultSiliconFlowCatalog.ts`), quindi il gate non si applica mai in questo caso e non blocca alcunché. *(Correzione post-verifica, 2026-08-18: una verifica di sola lettura ha confermato che questa era la spiegazione causale errata nella versione originale di questo paragrafo.)* Il meccanismo reale più probabile è la combinazione di due difetti indipendenti e più semplici, entrambi confermati nel codice: il fallback silenzioso e non segnalato all’utente quando il Workspace non risolve il modello preferito nel catalogo idratato (vedi §4 "fallback e fallimenti di risoluzione sono opachi" più sotto — ora reso visibile via notifica, PR `fix/model-fallback-visibility-and-double-optimize`), e un bug di budget di token deterministico nell’optimizer (`optimize_user_prompt.maxCompletionTokens` era 1200, troppo basso per una riscrittura di brief completa — vedi PR `fix/optimize-user-prompt-token-budget`).

**Impatto:** una configurazione costo che elenca Kimi/MiniMax può convivere con un artefatto DeepSeek senza errore tecnico locale, ma con una violazione grave della semantica di prodotto.

### P0 — l’handoff GodMode seleziona il task semanticamente sbagliato

Nel passaggio verso Workspace, la pagina launch privilegia `vibeGenerate` e poi `generate`, invece della configurazione `godModeGenerate`. *(Correzione post-verifica, 2026-08-18: questa conclusione va ammorbidita.)* `vibeGenerate` (task key `vibe_mode_generate` in `PlatformConfig.ts`) è in realtà coerente con l’intento già documentato di quella stessa chiave — il commento del codice recita testualmente: `// Vibe Mode — final generation step (workspace model when arriving from Vibe Mode expert path)`. Il percorso qui descritto (Vibe → Zero Effort → GodMode) **è** l’"expert path" da Vibe Mode a cui quel commento si riferisce, quindi l’uso di `vibeGenerate` non è un instradamento sbagliato per questo specifico percorso. Il percorso di ingresso standalone a GodMode (senza passare da Vibe) usa correttamente `godModeGenerate` già oggi. Il problema reale resta comunque la mancanza di un lock di pipeline unico: percorsi diversi risolvono legittimamente task key diverse, ma nessuna delle due garantisce oggi la coerenza con il modello scelto dall’utente all’inizio del flusso.

### P0 — l’ottimizzazione viene sempre riattivata

`handleGodModeGenerate()` esegue sempre `zero_effort_optimize`. L’URL `skipAutoOptimize=1` sopprime l’optimizer del Workspace solo quando il brief è AI-prefilled; per il percorso manuale la seconda ottimizzazione resta attiva. Il Workspace quindi può creare il passaggio addizionale `optimize_user_prompt`, come osservato con MiniMax-M3.

**Impatto:** il flusso richiesto “brief completo → GodMode senza ottimizzazione” è impossibile da ottenere in modo affidabile.

### P0 — esistono due generatori di brief

Il server `LaunchZeroEffortProject` costruisce e persiste un `normalizedBrief`. La pagina launch ricostruisce però un secondo `buildStructuredBrief()` lato client, con formattazione e fonti parzialmente diverse, e passa quest’ultimo all’optimizer e poi al Workspace.

**Impatto:** il brief persistito, quello visto nella UI e il prompt effettivamente riscritto possono divergere. Un optimizer può inoltre comprimere o perdere dettagli del brief più ricco, creando il sintomo riportato: “brief zero effort più ricco del prompt zero effort”.

### P1 — configurazione letta in parallelo alla mutazione del progetto

Zero Effort lancia la persistenza del brief/preset e il recupero della configurazione in parallelo. Il recupero può quindi valutare la configurazione sul preset precedente. È una race condition che aggrava la deriva del modello.

### P1 — fallback e fallimenti di risoluzione sono opachi

Se il modello preferito non viene risolto nel catalogo locale del Workspace, la UI può eliminare l’override e ripiegare sulla selezione predefinita senza un errore bloccante. Anche i task hanno differenti strategie di accettazione dell’override. L’utente non riceve né la causa né la coppia effettiva prima del dispatch.

### P1 — `sessionStorage` e query URL governano dati canonici

Il prompt da inviare e l’identità del modello attraversano il browser tramite `sessionStorage` e parametri URL. Sono meccanismi utili per navigazione effimera, ma non possono essere autorità di un flusso che deve essere ripetibile, auditabile e resistente a refresh/disconnessione.

## 5. Contratto del flusso desiderato

### 5.1 Invarianti non negoziabili

1. La selezione utente viene validata dal server al primo submit e congelata nel `PipelineRun`.
2. Con policy `strict`, classify, prefill, generazione finale e ogni altro stage LLM testuale usano la stessa coppia provider/modello.
3. Se il modello non è disponibile o non supporta una capacità obbligatoria, il run è `blocked`: nessun fallback silenzioso. La UI chiede una nuova scelta oppure un’eccezione esplicita.
4. Il brief canonico è costruito una sola volta dal backend. Ogni rappresentazione UI è una proiezione di quel record.
5. Il brief canonico viene inviato a GodMode come messaggio `user` invariato; system prompt e guideline sono composti separatamente dai layer di prompting.
6. Il percorso “avvia da Vibe” imposta `optimizationPolicy: skip`; né `zero_effort_optimize` né `optimize_user_prompt` possono essere invocati per quel run.
7. Ogni dispatch persiste `pipelineRunId`, stadio, modello richiesto, modello effettivo, motivo di eventuale eccezione e hash del brief/payload.
8. Workshop mostra il run selezionato: modello scelto, modello effettivo per stadio, brief inviato e payload safe effettivo. Non ricompone né deduce dati nel browser.

### 5.2 Sequenza target

```text
POST Vibe start (input, selected provider/model, strict)
  → validate catalog/provider access/capabilities
  → create PipelineRun + immutable model lock
  → execute Vibe classify and prefill under the lock
  → BuildCanonicalGenerationBrief once on server
  → persist brief envelope + conversation user message
  → transition run to ready_for_godmode

POST pipeline-runs/:id/launch-godmode
  → assert lock and optimizationPolicy=skip
  → compose PromptExecutionEnvelope (system/guidelines + exact canonical brief)
  → persist dispatch before provider call
  → call locked provider/model
  → finalize execution, conversation, snapshot and cost records
  → return PipelineRun projection to UI
```

Il primo endpoint può eseguire il launch GodMode direttamente se UX e timeout lo consentono; in entrambi i casi la transizione è server-owned. Il Workspace non deve chiamare un optimizer né ricostruire il messaggio per “completare” il run.

## 6. Design concreto di refactor

### Fase 0 — fermare l’ambiguità e produrre prova diagnostica (P0)

- Definire in `packages/contracts` `PipelineRun`, `PipelineModelLock`, `CanonicalBriefEnvelope`, `PipelineStageExecution` e gli errori `MODEL_LOCK_UNAVAILABLE` / `MODEL_LOCK_CAPABILITY_MISMATCH`.
- Centralizzare la risoluzione in un unico use case, ad esempio `ResolvePipelineModelLock`; eliminare priorità duplicate dai route handler e dalla UI.
- Aggiungere log strutturati per ogni dispatch: `pipelineRunId`, stage, requested/effective provider-model, origine della decisione, catalog revision, fallback/exception reason. Non registrare chiavi né payload sensibili.
- Rendere bloccante la mancata risoluzione di un modello lockato. La UI deve mostrare l’errore e non inviare l’artefatto con un modello diverso.

**Accettazione:** un test E2E con Kimi K3 selezionato dimostra lo stesso id in Vibe, brief generation e artifact; un Kimi non disponibile termina in errore esplicito e non produce una chiamata DeepSeek/MiniMax.

### Fase 1 — brief canonico e rimozione della doppia ottimizzazione (P0)

- Estrarre `BuildCanonicalGenerationBrief` nell’application layer; rimuovere la costruzione concorrente del brief dalla pagina launch.
- Salvare testo, schema, hash, campi sorgente e provenienza inferita nel run e nel progetto/moodboard secondo responsabilità; il testo da inviare viene sempre dal run.
- Sostituire l’handoff `sessionStorage` del prompt con `pipelineRunId`; URL può contenere solo un id non sensibile di navigazione.
- Introdurre `optimizationPolicy` persistita. Per Vibe → Zero Effort → GodMode: `skip`; il server rifiuta qualunque chiamata optimizer per quel run salvo una futura azione utente esplicita che crei un nuovo run/branch.
- Recuperare la configurazione soltanto dopo il salvataggio del progetto/preset oppure, preferibilmente, risolverla dal run già creato.

**Accettazione:** il contenuto hash del brief in UI, messaggio user, `PromptExecution` e provider request coincide; nessun record `zero_effort_optimize` o `optimize_user_prompt` è associato al run con policy `skip`.

### Fase 2 — handoff GodMode e trasparenza Workshop (P1)

- Sostituire i parametri `preferredProvider`/`preferredModel` come autorità con una lettura del run server-side. I parametri possono essere mantenuti solo come proposta iniziale per un nuovo run, non per uno esistente.
- Usare semanticamente `godModeGenerate` soltanto per le policy di un nuovo run senza lock utente; un lock già creato prevale su qualsiasi task setting.
- Collegare `PipelineStageExecution`, `PromptExecution`, messaggi, snapshot e cost transactions mediante `pipelineRunId` ed `executionId`.
- Estendere il read model Workshop: badge “locked”, provider/modello richiesto ed effettivo, stadio, politica di ottimizzazione, hash/preview del brief canonico e collegamento alla request safe realmente inviata.

**Accettazione:** selezionando uno snapshot in Workshop, la UI mostra il run e la coppia che lo ha effettivamente generato. I costi sono raggruppati per run e distinguono chiaramente costo del brief da costo dell’artefatto.

### Fase 3 — eliminazione controllata delle fonti obsolete (P1)

- Rimuovere la persistenza dell’override Vibe in `localStorage` e il trasferimento del prompt canonico in `sessionStorage` dopo la migrazione.
- Mantenere i task `promptTaskSettings` come default amministrativi per run senza selezione lockata, non come override nascosto di una scelta utente.
- Aggiungere migration/read compatibility per run e conversazioni storiche; le esecuzioni precedenti devono essere etichettate “legacy / model lock unavailable”, non reinterpretate.
- Aggiornare le specifiche storiche indicate nella sezione seguente prima di ogni feature che tocchi Vibe, Zero Effort o GodMode.

## 7. Gerarchia di configurazione dopo il refactor

| Priorità | Fonte | Quando si applica | Visibilità |
| --- | --- | --- | --- |
| 1 | `PipelineRun.modelLock` | run creato da scelta utente | obbligatoria in UI e in tutti i record |
| 2 | eccezione di capacità esplicitamente approvata nel run | solo capacità dichiarata incompatibile | obbligatoria, con motivazione |
| 3 | `promptTaskSettings` risolti server-side | nuovo run senza lock utente | mostrata come “default amministrativo” |
| 4 | catalogo runtime per ruolo/capability | solo fallback iniziale per creare un nuovo run | mostrato prima della conferma |

Le preferenze browser non fanno parte della gerarchia di esecuzione. Possono precompilare il picker, ma non modificano un run esistente.

## 8. Matrice di test obbligatoria

| Caso | Setup | Risultato atteso |
| --- | --- | --- |
| Kimi K3 lockato | selezione utente Kimi → Vibe → launch automatico | ogni stadio testuale e artefatto riportano Kimi; zero fallback |
| Modello lockato assente | il catalogo non contiene più Kimi | run bloccato prima del dispatch; UI spiega la condizione |
| Capacità non supportata | step richiede capacità fuori contratto | richiesta esplicita di eccezione o stop; niente sostituzione invisibile |
| Vibe con brief ricco | prefill popola tutti i campi | hash e contenuto del brief coincidono fra run, user message e provider payload |
| Vibe → GodMode skip | policy `skip` | nessun record optimizer; una sola generazione finale |
| Zero Effort manuale | non prefilled | stessa policy e assenza di doppia ottimizzazione quando scelta dall’utente |
| Refresh fra launch e Workspace | run già pronto | ripresa dal `pipelineRunId`, senza perdita o riscrittura del brief |
| Snapshot storico | run legacy | UI dichiara assenza del model lock senza inventare dati |

## 9. Stato delle specifiche e prevenzione delle direttive obsolete

| Documento | Ruolo dopo questa decisione | Regola di precedenza |
| --- | --- | --- |
| Questa analisi | autorità per model lock, brief canonico e passaggio Vibe/Zero Effort/GodMode | prevale sulle sezioni in conflitto |
| `PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md` | autorità per esecuzione immutabile e trasparenza del payload | complementare e obbligatorio |
| `ZERO_EFFORT_PREFILL_SPEC.md` | descrive il dominio di prefill | non autorizza doppio brief, optimizer implicito o handoff client-owned |
| `MULTIMODE_UX_MVP_EXECUTION_SPEC.md` | visione UX storica/additiva | non è un’autorizzazione a bypassare backend orchestration SSOT |
| `DASHBOARD_LOVABLE_CHAT_SPEC.md` | riferimento storico per intent classifier | le sue scelte per-task di modelli economici non prevalgono su un user model lock |
| `PROMPT_OPTIMIZER_SPEC.md` | ottimizzazione esplicita | non abilita optimizer automatico in un run con policy `skip` |

Prima di implementare, gli agenti devono leggere prima questo documento e l’analisi Prompt Execution SSOT. Se una specifica più vecchia prescrive un fallback o una ricomposizione client-side incompatibile, va aggiornata oppure marcata storica: non deve essere reintrodotta nel runtime.

## 10. Rischi residui e decisioni aperte

- **Identificatore Kimi:** il catalogo deve mantenere un id canonico e alias controllati (`moonshotai/kimi-k3` osservato localmente; il nome commerciale “Kimi 3” non è sufficiente come chiave). Provider, catalog revision e model id fanno parte del lock.
- **Costo/qualità:** un modello unico per tutti gli stadi può aumentare costo e latenza. È una scelta esplicita del prodotto richiesta dall’utente; l’alternativa multi-modello va offerta solo come policy dichiarata e con preview degli stage, mai nascosta.
- **Run sincrono:** Vibe e la generazione finale possono richiedere un job asincrono. L’eventuale asynchrony non modifica l’autorità: run, lock e brief sono persistiti prima dell’enqueue.
- **Migrazione:** i dati storici non contengono sempre la decisione iniziale. Devono restare leggibili come legacy, senza inferenze retroattive.

## 11. Ordine consigliato di consegna

1. Contratti e risolutore server unico, con test di blocco fallback.
2. Persistenza `PipelineRun` e brief canonico; collegamenti a execution/costi/snapshot.
3. Endpoint server-owned per launch GodMode con `optimizationPolicy: skip`.
4. Migrazione della UI: rimuovere prompt/model come autorità in storage e query, mostrare stato del run.
5. E2E locale Docker completo con Kimi K3, incluse prove di payload, artefatto, snapshot e costi.
6. Pulizia/annotazione delle specifiche storiche soltanto dopo che i test provano il nuovo contratto.

Nessuna fase successiva — inclusi Template Skills, nuove capability o ottimizzazioni UX — deve ampliare il prompting pipeline finché i test P0 non dimostrano che scelta, brief, payload, modello e artefatto rimangono coerenti.
