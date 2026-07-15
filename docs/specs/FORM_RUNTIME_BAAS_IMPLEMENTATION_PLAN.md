# Form Runtime + BaaS Delivery — Piano di implementazione agent-executable

> Stato: **proposta pronta per pianificazione; implementazione non autorizzata automaticamente**
> Data: 2026-07-13; allineamento architetturale: 2026-07-15
> Parent spec: [BAAS_SERVICES_SPEC.md](BAAS_SERVICES_SPEC.md)
> Decisione corrente: [PLATFORM_CAPABILITY_RUNTIME.md](../architecture/PLATFORM_CAPABILITY_RUNTIME.md)
> Vincolo roadmap: R4 è sospeso in [ROADMAP.md](../project/ROADMAP.md) finché osservabilità e publishing non sono stabilizzati.
> Obiettivo operativo: rendere il lavoro eseguibile in sequenza anche da un modello di fascia economica, senza decisioni architetturali implicite.

---

## 1. Risultato atteso

Andy Code Cat deve offrire un unico modulo form dichiarativo, riutilizzabile in preview, publish
e ZIP export. L'LLM sceglie la tipologia e la struttura del form; il backend valida un manifest
JSON e un motore deterministico costruisce il comportamento. La consegna è configurabile senza
rigenerare il progetto:

1. `mailto` — default iniziale, nessuna chiamata al backend Andy Code Cat e nessuna submission
   persistita dalla piattaforma;
2. `relay` — endpoint pubblico validato che invia via SMTP/API provider senza salvare il payload;
3. `capture` — endpoint pubblico che salva la submission, espone una inbox al proprietario e può
   inviare notifiche o double opt-in.

Il sistema deve impedire all'LLM di inventare endpoint, destinatari, credenziali, basi giuridiche,
retention o campi non ammessi. La configurazione risolta segue:

```text
PlatformFormPolicy
        ↓
User/Tenant EmailDeliveryProfile
        ↓
ProjectFormSettings
        ↓
ServiceManifest generato dall'LLM
        ↓
ValidatedFormDefinition + runtime pubblico
```

La modalità `mailto` apre una bozza nel client dell'utente. Non può dichiarare che il messaggio è
stato inviato. `relay` e `capture` sono le modalità affidabili per produzione.

---

## 2. Documenti e source of truth da leggere

Un agente deve leggere, nell'ordine, prima di modificare codice:

1. [AGENTS.md](../../AGENTS.md) — layering, double sandbox, Docker, documentazione e Gitflow.
2. [CODE_AGENT_INDEX.md](../agents/CODE_AGENT_INDEX.md) — stato corrente e aree congelate.
3. [PRODUCT_VISION.md](../project/PRODUCT_VISION.md) — direzione `serviceManifest` e BaaS dichiarativo.
4. [ROADMAP.md](../project/ROADMAP.md) — gate R2/R3 e sospensione R4.
5. [PLATFORM_CAPABILITY_RUNTIME.md](../architecture/PLATFORM_CAPABILITY_RUNTIME.md) — decisione
   corrente per runtime dichiarativo, scope tenant/progetto/capability, persistenza e roadmap.
6. [BAAS_SERVICES_SPEC.md](BAAS_SERVICES_SPEC.md) — catalogo storico/parent per public key, CORS,
   rate limit e owner API; in caso di conflitto sui meccanismi prevale la decisione corrente.
7. [PRESET_TYPED_SPECS.md](PRESET_TYPED_SPECS.md) — preset `form` e `stepped_form`.
8. [TEMPLATE_SKILLS_LAYER_S_IMPLEMENTATION.md](TEMPLATE_SKILLS_LAYER_S_IMPLEMENTATION.md) — istruzioni
   form filesystem-first già iniettate dal runtime.
9. [LLM_JSON_PARSING_GUIDELINES.md](../guides/LLM_JSON_PARSING_GUIDELINES.md) — parsing, repair,
   normalizzazione e compatibilità multi-provider.
10. [EXPORT_AND_PUBLISH_SPEC.md](EXPORT_AND_PUBLISH_SPEC.md) — snapshot, ZIP e publish.
11. [SECURITY_BASELINE.md](../security/SECURITY_BASELINE.md) — auth, isolamento e secret safety.
12. [USER_SETTINGS_AND_API_KEYS_SPEC.md](USER_SETTINGS_AND_API_KEYS_SPEC.md) — configurazione role-scoped
    e direzione BYOK.
13. [PROMPTING_PIPELINE_AGENT_GUARDRAILS.md](../agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md) — regole
    obbligatorie se una wave modifica output schema, parser o prompt.
14. [GITFLOW_RELEASE_POLICY.md](../guides/GITFLOW_RELEASE_POLICY.md) e
    [AGENT_RELEASE_CHECKLIST.md](../guides/AGENT_RELEASE_CHECKLIST.md) prima di branch, commit o PR.

Riferimenti normativi esterni, da usare senza trasformare il prodotto in consulenza legale:

- [Regolamento UE 2016/679](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679),
  in particolare articoli 5, 6, 7, 13 e 25;
- [RFC 6068](https://www.rfc-editor.org/rfc/rfc6068) per URI `mailto`, percent-encoding e limiti;
- [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en).

---

## 3. Baseline reale verificata

### 3.1 Già implementato — riusare, non duplicare

- `apps/api/src/domain/entities/ProjectPreset.ts` contiene il preset `form` con wizard, validazione,
  review e success state.
- `packages/contracts/src/vibecore.ts` espone `interactive_form`.
- `docs/skills/template-skills/by-template/form/` contiene le istruzioni Layer S per UX,
  validazione, accessibilità e product craft.
- `LlmStructuredResponse` contiene `chat`, `artifacts`, `mediaManifest` e `focusPatch`.
- `chatRequestAdapter.ts` possiede lo schema JSON strict usato dai provider che supportano
  structured output.
- `llmParser.ts` possiede una pipeline di repair e il precedente riusabile del rescue di
  `mediaManifest` top-level, nested e double-encoded.
- `PreviewSnapshot`, `CreatePreviewSnapshot`, publish ed export formano il percorso canonico degli
  artefatti.
- `CryptoService` usa AES-256-GCM e `MongoServiceApiKeyRepository` dimostra il pattern di cifratura
  at-rest. Va esteso con domain separation, senza cambiare la derivazione preesistente.
- `authMiddleware` e `projectSandboxMiddleware` sono obbligatori per tutte le owner API.
- `ExecutionLog` è il sink di audit esistente; non creare una seconda collezione di log BaaS.
- MongoDB e Redis sono già nel topology Docker, ma l'API non usa ancora un client Redis.

### 3.2 Non implementato — non dichiarare completato

- `serviceManifest` / `formManifest` nel contratto LLM;
- persistenza del manifest nello snapshot;
- compiler/runtime deterministico per form;
- `ProjectServiceConfig`, public project key e allowlist origin;
- profili SMTP per piattaforma/utente;
- public Forms API;
- Redis rate limiting condiviso;
- submission inbox, retention e double opt-in;
- UI impostazioni form/profili email;
- test E2E preview → publish/export → submit.

### 3.3 Conflitti risolti da questo piano

1. Il parent spec descrive un `SECRET_VAULT_KEY`; il codice corrente possiede già `CryptoService`
   derivato da segreti obbligatori. Questo piano riusa `CryptoService` con un parametro `context`
   additivo e default invariato. Non introdurre un secondo cifratore.
2. Il parent spec salva sempre `FormSubmission`; questo piano separa `relay` da `capture` per
   permettere invio senza persistenza.
3. Il parent spec storico richiede chiamate `PF.forms.submit()` generate nell'artefatto. Questo è
   superseded: l'LLM emette slot + manifest; il runtime platform-owned sceglie localmente `mailto`
   oppure chiama il public endpoint per `relay/capture`. `artifacts.js` non implementa il submit.
4. La visione parla di `serviceManifest`; non creare un `formManifest` concorrente. Il contratto
   canonico sarà `serviceManifest`, inizialmente con la sola capability `forms`.

---

## 4. Invarianti non negoziabili

### 4.1 Architettura

- Presentation routes chiamano use case; non accedono direttamente a MongoDB.
- Application dipende da porte del domain, non da repository Mongo o Nodemailer.
- Infra implementa MongoDB, Redis, SMTP e cifratura.
- Il manifest validato in `packages/contracts` è l'unico contratto condiviso.
- Il runtime non esegue JavaScript generato dall'LLM per inviare dati.
- L'LLM non riceve né emette credenziali o configurazioni SMTP.
- `serviceManifest` è additivo e versionato; output senza manifest continua a funzionare.

### 4.2 Sicurezza

- Owner API: JWT subject + `x-project-id` + verifica `project.ownerUserId == jwt.sub`.
- Public API: project public key, origin allowlist, payload limit, schema whitelist, rate limit e
  log redatto.
- Nessun valore submission in log, errori, metriche o notifiche operative.
- Password SMTP cifrata at-rest e decifrata solo nell'adapter al momento dell'invio.
- `from` proviene dal profilo verificato; l'email del visitatore può essere solo `replyTo`.
- TLS obbligatorio: `implicit_tls` o `starttls_required`; nessuna modalità plaintext.
- Host SMTP BYOK deve passare una policy anti-SSRF e DNS rebinding prima della connessione.
- HTML non è un tipo campo ammesso; testo utente è sempre trattato come testo.

### 4.3 Privacy

- Il catalogo può offrire molti campi, ma il form usa il minimo necessario per la finalità.
- Dati particolari ex art. 9 sono vietati di default.
- Presa visione dell'informativa e consenso marketing sono due controlli distinti.
- `mailto` significa “nessuna persistenza Andy Code Cat”, non “nessun trattamento dati”.
- Newsletter produttiva richiede prova del consenso e double opt-in; `mailto` può solo creare una
  richiesta di iscrizione.
- Ogni submission `capture` porta `purposeKey`, versione informativa e scadenza retention.

---

## 5. Contratto canonico `serviceManifest`

Creare `packages/contracts/src/serviceManifest.ts` e riesportarlo da `index.ts`.

### 5.1 Shape v1

```ts
type FormKind =
    | "contact"
    | "commercial_lead"
    | "quote_request"
    | "booking_request"
    | "newsletter_request"
    | "feedback"
    | "survey"
    | "onboarding"
    | "custom";

type FormFieldType =
    | "text"
    | "email"
    | "tel"
    | "textarea"
    | "number"
    | "select"
    | "radio"
    | "checkbox"
    | "date"
    | "time"
    | "url"
    | "hidden_context";

interface ServiceManifestV1 {
    version: "service-manifest-v1";
    forms: FormDefinitionV1[];
}

interface FormDefinitionV1 {
    id: string;                    // kebab-case, max 48
    kind: FormKind;
    title: string;                 // max 120
    description?: string;          // max 500
    purposeKey: string;            // registry key, non-freeform after normalization
    steps: FormStepV1[];           // 1..5
    submitLabel: string;           // max 60
    successMessage: string;        // max 300; adapter mailto lo normalizza
    privacyNoticeRef: "project-default";
}

interface FormStepV1 {
    id: string;
    title: string;
    description?: string;
    fields: FormFieldV1[];         // 1..5 visibili per step
}

interface FormFieldV1 {
    id: string;                    // field registry id oppure custom-* ammesso dalla policy
    type: FormFieldType;
    label: string;
    description?: string;
    placeholder?: string;
    required: boolean;
    autocomplete?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    patternKey?: "postal_code" | "vat_id" | "fiscal_code" | "custom_safe";
    options?: Array<{ value: string; label: string }>;
    dataCategory: "identity" | "contact" | "request" | "preference" | "consent" | "context";
}
```

### 5.2 Limiti Zod obbligatori

- massimo 5 form per manifest;
- massimo 5 step per form;
- massimo 5 campi visibili per step e 20 campi totali;
- massimo 20 opzioni per select/radio;
- ID lowercase kebab-case unici nel proprio scope;
- stringhe `.trim()` con limiti espliciti;
- vietare chiavi sconosciute con `.strict()`;
- `checkbox` di consenso non può avere valore pre-selezionato;
- `newsletter_request` deve contenere `email`, `privacy-acknowledgement` e
  `marketing-consent` come campi distinti;
- `hidden_context` può contenere solo valori server/configurazione allowlisted, mai query param
  arbitrari copiati senza validazione;
- `custom_safe` non accetta regex emessa dall'LLM: risolve una regex configurata dal sistema.

### 5.3 Catalogo standard massimale

Il catalogo è un insieme di possibilità, non un elenco da mostrare integralmente. Creare
`apps/api/src/application/forms/standardFieldCatalog.ts` con almeno:

- identità: `first-name`, `last-name`, `full-name`, `company`, `job-title`;
- contatto: `email`, `phone`, `website`, `preferred-contact-channel`;
- richiesta: `subject`, `message`, `service-interest`, `budget-range`, `timeline`;
- indirizzo non sensibile: `city`, `province`, `country`, `postal-code`;
- appuntamento: `preferred-date`, `preferred-time`, `timezone`;
- feedback: `rating`, `feedback`, `would-recommend`;
- contesto: `project-name`, `source-page`, `campaign-code`;
- privacy: `privacy-acknowledgement`, `marketing-consent`.

Vietare nella policy standard: salute, biometria, origine etnica, religione, opinioni politiche,
orientamento sessuale, dati giudiziari, documenti d'identità, password, credenziali, carte di
pagamento e upload file. Una futura capability specializzata richiederà un'altra spec.

---

## 6. Configurazione separata dal manifest LLM

### 6.1 `ProjectFormSettings`

Estendere `Project` con un campo additivo opzionale:

```ts
interface ProjectServiceConfig {
    publicKey: string;
    allowedOrigins: string[];
    forms?: ProjectFormSettings;
}

interface ProjectFormSettings {
    enabled: boolean;
    mode: "mailto" | "relay" | "capture";
    recipientEmail?: string;          // fallback: email account owner
    emailDeliveryProfileId?: string;  // obbligatorio per relay/capture SMTP BYOK
    privacyNotice: {
        version: string;
        url: string;
        controllerName: string;
        contactEmail: string;
    };
    retentionDays: number;            // usato solo da capture; policy clamp
    confirmationEnabled: boolean;
    doubleOptInEnabled: boolean;
}
```

Regole:

- `publicKey` è UUID casuale non segreto, non Mongo ObjectId;
- Mongo deve avere un indice unique sparse su `serviceConfig.publicKey`; collisioni generano una
  nuova key prima del commit, non sovrascrivono il progetto;
- per progetti legacy la key viene creata lazy al primo GET/PUT settings o tramite migrazione
  idempotente; non rigenerarla mai automaticamente;
- `allowedOrigins` non ammette `*`; path publish aggiorna l'origine pubblica automaticamente;
- `mailto` ignora `emailDeliveryProfileId`;
- `relay` non usa `retentionDays`;
- `capture` limita retention alla policy piattaforma;
- `newsletter_request` in `capture` richiede `doubleOptInEnabled=true` prima di definirsi
  iscrizione completata.

### 6.2 `EmailDeliveryProfile`

Nuova entity domain, separata da `ServiceApiKey` perché possiede metadati SMTP strutturati:

```ts
interface EmailDeliveryProfile {
    id: string;
    ownerType: "platform" | "user";
    ownerUserId?: string;
    label: string;
    transport: "smtp";                // provider_api fuori v1
    host: string;
    port: 465 | 587;
    tlsMode: "implicit_tls" | "starttls_required";
    username: string;
    encryptedPassword: string;
    iv: string;
    authTag: string;
    fromAddress: string;
    fromName?: string;
    enabled: boolean;
    verificationStatus: "unverified" | "verified" | "failed";
    verifiedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
```

Non restituire mai `encryptedPassword`, `iv` o `authTag` nei DTO. Restituire solo
`passwordConfigured: boolean`.

### 6.3 Domain separation cifratura

Modificare `CryptoService` in modo additivo:

```ts
constructor(jwtAccessSecret: string, dbName: string, context = "service-api-keys")
```

Usare `context` nel parametro HKDF `info`. Il default deve restare esattamente
`service-api-keys`, così tutte le chiavi esistenti restano decifrabili. Il repository SMTP usa
`email-delivery-profiles-v1`.

### 6.4 `PlatformConfig.formPolicy`

Estendere il singleton `PlatformConfig` e i relativi contratti admin con un blocco additivo. Il
resolver deve applicare default code-safe anche ai documenti Mongo legacy:

```ts
interface PlatformFormPolicy {
    enabled: boolean;
    allowedModes: Array<"mailto" | "relay" | "capture">;
    maxFormsPerManifest: number;       // default 5, hard max 10
    maxStepsPerForm: number;           // default/hard max 5
    maxFieldsPerForm: number;          // default 20, hard max 30
    maxVisibleFieldsPerStep: number;   // default/hard max 5
    maxPayloadBytes: number;           // default/hard max 16384
    maxTextFieldChars: number;         // default 1000, hard max 5000
    mailtoMaxUriChars: number;         // default 1800, fallback copy oltre soglia
    defaultRetentionDays: number;      // default 90
    maxRetentionDays: number;          // default 365, hard max 730
    allowUserSmtpProfiles: boolean;
    allowedSmtpPorts: Array<465 | 587>;
    requireTls: true;
    projectRequestsPerMinute: number;  // default 60
    formIpSubmissionsPerDay: number;   // default 10
    forbiddenDataCategories: string[]; // include sempre le categorie §5.3
}
```

Le soglie “hard max” restano nel codice e non possono essere aumentate dall'admin. La UI può
ridurre i limiti operativi, non disabilitare TLS, double sandbox, sensitive-data block o
minimizzazione. Un progetto può scegliere solo valori più restrittivi rispetto alla piattaforma.
Quando seleziona un `emailDeliveryProfileId`, il resolver accetta soltanto un profilo platform
abilitato oppure un profilo con `ownerUserId == project.ownerUserId`.

---

## 7. Motore form e runtime pubblico platform-owned

### 7.1 Ownership del rendering

L'LLM emette nel proprio HTML soltanto slot dichiarativi:

```html
<section class="contact-flow">
  <div data-pf-form-id="commercial-contact"></div>
</section>
```

Può creare CSS per lo slot e per le classi pubbliche documentate, ma non il submit handler.
`FormRuntimeCompiler` verifica che ogni form manifest abbia uno slot e che ogni slot punti a un
form esistente. Slot duplicati sono permessi solo se marcati `data-pf-form-instance` univoci.

### 7.2 Runtime deterministico

Creare un runtime vanilla JS senza dipendenze frontend, utilizzabile sia inline nello ZIP sia
come asset versionato nel publish:

```text
PF.forms.mountAll(runtimeConfig)
PF.forms.validate(formId, values)
PF.forms.submit(formId, values)
```

`PF.forms.*` è un namespace interno al modulo platform-owned, non un contratto che l'LLM deve
invocare da `artifacts.js`. Il compiler monta gli slot e collega l'adapter configurato dopo la
generazione.

Il renderer deve:

- generare label associate, fieldset/legend per radio, errori con `aria-describedby`, progress
  state e live region;
- usare `textContent`/DOM API, mai concatenazione di HTML con dati utente;
- preservare valori avanti/indietro;
- validare per step e al submit;
- impedire double submit;
- mostrare stati loading, errore, bozza aperta e successo;
- non mostrare mai “inviato” in modalità `mailto`;
- essere idempotente se eseguito due volte;
- supportare assenza JavaScript con fallback testuale e indirizzo di contatto.

### 7.3 Adapter `mailto`

- costruire la URI solo al click, non inserirla con dati personali nella URL HTTP della pagina;
- consentire solo `to`, `subject` e `body`;
- `to` e subject template provengono dalla configurazione trusted;
- rimuovere CR/LF da header e percent-encodare UTF-8 secondo RFC 6068;
- corpo breve e testuale; nessun allegato;
- se la URI supera il limite operativo configurato, offrire “Copia riepilogo” e aprire una bozza
  ridotta;
- success state: “La bozza è stata aperta. Verifica e invia dalla tua app email.”;
- mostrare fallback se nessun protocol handler è disponibile;
- documentare che il recipient email è visibile nell'artefatto pubblico.

### 7.4 Adapter `relay/capture`

```text
POST /v1/public/svc/:projectKey/forms/:formId/submit
Content-Type: application/json
Origin: https://published.example
```

Body canonico:

```json
{
  "manifestVersion": "service-manifest-v1",
  "values": { "full-name": "...", "email": "...", "message": "..." },
  "consent": {
    "privacyNoticeVersion": "2026-07-13",
    "privacyAcknowledged": true,
    "marketingConsent": false
  },
  "context": { "sourcePage": "/contact" }
}
```

Il server ignora campi extra e valida contro il manifest persistito dello snapshot/deployment
attivo, non contro una whitelist fornita dal client.

---

## 8. API target

### 8.1 Owner API — sempre JWT + project sandbox

```text
GET  /v1/projects/:projectId/services/forms/settings
PUT  /v1/projects/:projectId/services/forms/settings
POST /v1/projects/:projectId/services/forms/rotate-public-key
GET  /v1/projects/:projectId/services/forms/:formId/submissions
GET  /v1/projects/:projectId/services/forms/:formId/submissions/:submissionId
DELETE /v1/projects/:projectId/services/forms/:formId/submissions/:submissionId
```

Rotazione public key richiede conferma esplicita e invalida gli artefatti pubblicati che usano la
key precedente. Non inserirla nel normale PUT settings.

### 8.2 Delivery profiles

```text
GET    /v1/settings/email-delivery-profiles
POST   /v1/settings/email-delivery-profiles
PATCH  /v1/settings/email-delivery-profiles/:profileId
POST   /v1/settings/email-delivery-profiles/:profileId/verify
DELETE /v1/settings/email-delivery-profiles/:profileId
```

- utente normale vede solo i propri profili;
- superadmin può gestire profili platform tramite route admin o role-scoped nello stesso shell;
- un profilo referenziato da progetti non può essere cancellato senza prima disabilitarlo e
  risolvere le dipendenze;
- `verify` esegue un controllo di connessione autenticata senza inviare a destinatari arbitrari.

### 8.3 Public API

```text
GET  /v1/public/svc/:projectKey/forms/runtime-config
POST /v1/public/svc/:projectKey/forms/:formId/submit
GET  /v1/public/svc/:projectKey/forms/:formId/double-opt-in/:token
```

Il runtime config restituisce solo dati pubblici: manifest attivo, modalità, endpoint, testi
privacy, destinatario mailto se applicabile e limiti UX. Non restituisce profile ID interno,
username SMTP o segreti.

---

## 9. Persistenza

### 9.1 Snapshot

Aggiungere `serviceManifest?: ServiceManifestV1` a `PreviewSnapshot`, repository Mongo, DTO e use
case. Il manifest appartiene alla stessa versione di `artifacts`; non leggerlo dal progetto
corrente quando si pubblica uno snapshot storico.

Il salvataggio avviene in entrambi i percorsi `chat-preview` e stream. Il capture manuale da
messaggio usa il manifest parsato, se presente. Il focused edit mantiene il manifest precedente
se la risposta non ne contiene uno nuovo; se lo contiene, deve essere validato completamente.

### 9.2 `email_delivery_profiles`

Indici:

- `{ ownerType: 1, ownerUserId: 1, enabled: 1 }`;
- `{ ownerType: 1, ownerUserId: 1, label: 1 }` unique per scope;
- nessun indice su ciphertext o username.

### 9.3 `form_submissions`

```ts
interface FormSubmission {
    id: string;
    projectId: string;
    ownerUserId: string;
    capabilityInstanceId: string;
    deploymentId?: string;
    snapshotId: string;
    formId: string;
    formKind: FormKind;
    schemaVersion: string;
    purposeKey: string;
    values: Record<string, string | number | boolean>;
    searchableFields: Record<string, string | number | boolean>;
    consentEvidence: {
        privacyNoticeVersion: string;
        privacyAcknowledgedAt: Date;
        marketingConsent?: boolean;
        marketingConsentAt?: Date;
        source: "web_form";
    };
    doubleOptIn?: {
        status: "pending" | "confirmed" | "expired";
        requestedAt: Date;
        confirmedAt?: Date;
    };
    status: "new" | "read" | "archived";
    submittedAt: Date;
    expiresAt: Date;
}
```

Indici:

- `{ ownerUserId: 1, projectId: 1, capabilityInstanceId: 1, submittedAt: -1 }`;
- `{ ownerUserId: 1, projectId: 1, capabilityInstanceId: 1, status: 1, submittedAt: -1 }`;
- TTL `{ expiresAt: 1 }` con `expireAfterSeconds: 0`;
- token double opt-in salvato solo come hash in una collection/token record o subdocument dedicato;
  mai plaintext.

Non salvare IP o user-agent nella submission. L'abuse control usa Redis a TTL; l'audit usa un
hash IP salato e non reversibile senza payload.

`searchableFields` contiene esclusivamente copie normalizzate di campi approvati dalla policy. Non
abilitare ricerca full-text arbitraria sui valori PII e non rendere ricercabili campi cifrati per
comodità. Owner list/detail/delete devono ricevere uno scope completo
`{ ownerUserId, projectId, capabilityInstanceId }`; nessun filtro tenant è opzionale.

### 9.4 Isolamento fisico e logico

Default: collection condivise per capability (`form_submissions`, `capability_instances`,
`automation_jobs`) con scope composto obbligatorio in ogni documento, indice e query. Non creare
collection dinamiche come `form:{tenantId}` e non accettare nomi di database/collection dal
manifest o dal client.

Un database/cluster dedicato può essere un tier enterprise per pochi tenant con data residency,
backup/restore o scaling dedicati. Deve usare le stesse porte domain e gli stessi use case: la
separazione fisica non sostituisce double sandbox e query scope.

Il public submit non accetta `ownerUserId`, `projectId` o `capabilityInstanceId` dal body. Risolve
`projectKey` contro il deployment attivo e deriva server-side scope, manifest/schema, purpose e
retention prima di validare e persistere.

---

## 10. Policy GDPR standard

Creare un registry piattaforma con finalità note:

```text
contact_request
commercial_lead
quote_request
booking_request
newsletter_request
feedback
survey
onboarding
```

Ogni voce definisce:

- campi ammessi e minimi;
- categorie dati ammesse;
- retention default e massima;
- se marketing consent è vietato, opzionale o obbligatorio;
- se double opt-in è obbligatorio;
- testo UI neutro per informativa/presa visione;
- modalità di consegna compatibili.

Regole iniziali:

- `contact_request`, `quote_request`, `booking_request`: marketing consent sempre separato e non
  necessario per inviare la richiesta;
- `newsletter_request`: email + consenso marketing esplicito; niente checkbox pre-selezionato;
- `relay` non costituisce registro affidabile del consenso newsletter;
- `capture` salva evidence e avvia double opt-in;
- l'informativa standard è un template configurabile, non una dichiarazione di conformità legale;
- UI e documentazione mostrano “template da adattare e far verificare al titolare”.

La policy deve produrre errori machine-readable, per esempio:

```text
form_policy_field_not_allowed
form_policy_missing_required_field
form_policy_marketing_consent_coupled
form_policy_double_opt_in_required
form_policy_sensitive_data_forbidden
```

---

## 11. Rate limiting, CORS e anti-abuse

### 11.1 Redis

Aggiungere il client `redis` e un adapter `FormRateLimitStore` in infra. Configurare `REDIS_URL`
in `.env.example` e `apps/api/src/config.ts`; il compose già espone il servizio.

Chiavi suggerite, senza email o payload:

```text
baas:forms:project:{projectId}:minute
baas:forms:ip:{projectId}:{formId}:{ipHash}:day
baas:forms:optin:{tokenHash}
```

Default:

- 60 request/minuto per progetto;
- 10 submit/24h per project + form + IP hash;
- un double-opt-in token utilizzabile una volta;
- payload massimo 16 KB e 1000 caratteri per campo testuale, salvo limite più basso del manifest.

In produzione, Redis non disponibile deve rendere indisponibile il submit pubblico con 503
redatto: non fare fallback silenzioso a un limiter per-processo. In test/development è ammesso un
adapter memory esplicito.

### 11.2 Origin

- rifiutare Origin assente in produzione salvo policy documentata per client non-browser;
- confronto exact-origin normalizzato, mai suffix match;
- `*` vietato;
- publish aggiunge la propria origine; unpublish la rimuove solo se non usata da altri deployment;
- export esterno in `relay/capture` mostra istruzioni per registrare il dominio dell'artefatto.

### 11.3 SMTP anti-SSRF

Prima di connettere:

- accettare hostname, non URL;
- risolvere A/AAAA;
- bloccare loopback, private, link-local, multicast, unspecified, metadata endpoints e reti
  riservate IPv4/IPv6;
- bloccare porte diverse da 465/587;
- usare il risultato DNS validato durante la connessione oppure un lookup callback che ripete la
  validazione, per ridurre DNS rebinding;
- timeout connessione/auth/send espliciti;
- nessun redirect/proxy automatico;
- audit senza host credential o payload.

Questa sezione richiede review security prima del merge della Wave 6.

---

## 12. Piano di esecuzione per modello a costo ridotto

### 12.1 Profilo di esecuzione

Classificazione task:

- **L0 — meccanico:** tipi, export, wiring, documentazione, test già specificati. Modello economico.
- **L1 — implementativo confinato:** use case o adapter con contratto e test prescritti. Modello
  economico con review.
- **L2 — sensibile:** crittografia, public route, SSRF, retention/consenso, migrazione. Modello più
  forte o review obbligatoria di un secondo passaggio.

Regole per ogni sessione del modello economico:

1. Eseguire una sola task card.
2. Leggere solo i file elencati nella card più le dipendenze dirette.
3. Non cambiare nomi, endpoint o schema indicati dal piano.
4. Non modificare file fuori perimetro per “pulizia”.
5. Eseguire i test della card prima di proseguire.
6. Se uno stop condition si verifica, fermarsi e riportare file/errore; non inventare fallback.
7. Non avviare Docker senza prima verificare lo stack con `docker ps --format '{{.Names}}'`.
8. Non eseguire `docker compose down`.

### 12.2 Dependency graph

```text
W0 activation
  └─ W1 contracts/parser
       └─ W2 snapshot persistence
            ├─ W3 policy + runtime core
            │    └─ W4 mailto + project settings
            │         ├─ W5 publish/export integration
            │         └─ W6 SMTP profiles + relay
            │              └─ W7 capture + double opt-in
            └─ W8 frontend settings (after W4; SMTP panels after W6)
W9 E2E, docs, rollout depends on all selected production modes
```

---

## 13. Task cards atomiche

### W0 — Activation gate e baseline

**Tier:** L0. **Nessun codice prodotto.**

1. Confermare esplicitamente la riattivazione R4 oppure autorizzare soltanto W1–W5 come
   “Form Runtime mailto” privo di public BaaS.
2. Creare branch `feat/form-runtime-baas` da `develop`; se si implementa solo mailto usare
   `feat/declarative-form-runtime`.
3. Salvare output di baseline:
   - `npm run build -w packages/contracts`;
   - `npx tsc --noEmit -p apps/api/tsconfig.json`;
   - `npx tsc --noEmit -p apps/web/tsconfig.json`;
   - test parser/snapshot/publish/export esistenti.
4. Non correggere failure preesistenti; registrarli nel report di wave.

**Acceptance:** scope scritto, baseline nota, branch conforme.
**Stop:** R4 non riattivato e scope include W6/W7; worktree contiene conflitti sui file della card.

### W1 — Contratti e parser `serviceManifest`

**Tier:** L1.
**File target:**

- nuovo `packages/contracts/src/serviceManifest.ts`;
- `packages/contracts/src/index.ts`;
- `packages/contracts/src/llm.ts`;
- `apps/api/src/application/llm/chatRequestAdapter.ts`;
- `apps/api/src/application/llm/llmParser.ts`;
- `apps/api/src/application/llm/llmMessageBuilder.ts`;
- nuovi test `llmParser.serviceManifest.test.ts` e aggiornamento adapter/message tests.

**Passi:**

1. Implementare Zod strict con limiti §5.
2. Aggiungere `serviceManifest?: ServiceManifestV1` a `LlmStructuredResponse`.
3. Aggiungere `serviceManifest` allo structured-output schema come object-or-null e alla lista
   required, mantenendo compatibilità parser per provider senza structured output.
4. Riutilizzare il pattern `coerceManifestCandidate`; non duplicare la repair pipeline.
5. Rescue order: root object → root JSON string → `artifacts.serviceManifest` object/string.
6. Manifest invalido viene scartato con warning redatto; artefatti restano utilizzabili.
7. Prompt output: slot `data-pf-form-id`, manifest top-level, nessun submit handler custom.

**Test obbligatori:** valid, null, nested, double-encoded, malformed, duplicate IDs, field limit,
newsletter policy-shape base, output legacy senza manifest.
**Acceptance:** typecheck contracts/API e test parser verdi.
**Stop:** la modifica richiede rinominare `mediaManifest` o cambiare la repair order globale.

### W2 — Persistenza snapshot e propagazione

**Tier:** L1.
**File target:** entity/repository/infra/contract snapshot, `CreatePreviewSnapshot.ts`, i due save
site in `llmRoutes.ts`, capture da messaggio e relativi test.

**Passi:**

1. Aggiungere campo top-level snapshot opzionale.
2. Propagare nei due percorsi sync/stream.
3. Propagare nella creazione snapshot da messaggio.
4. Focused edit: ereditare manifest precedente solo quando risposta non lo sostituisce.
5. DTO list/detail non espone dati di configurazione o segreti; il manifest è pubblico per
   definizione ma resta associato allo snapshot.

**Test:** snapshot create/read, legacy document, sync/stream parity, focused edit inheritance.
**Acceptance:** nessun call site `create()` rotto; snapshot legacy leggibili.
**Stop:** per propagare il manifest si propone di rileggerlo dal raw LLM in publish/export.

### W3 — Policy engine e runtime core

**Tier:** L1 con review.
**Nuovi file suggeriti:**

```text
apps/api/src/application/forms/standardFieldCatalog.ts
apps/api/src/application/forms/formPolicyRegistry.ts
apps/api/src/application/forms/ValidateServiceManifest.ts
apps/api/src/application/forms/FormRuntimeCompiler.ts
apps/api/src/application/forms/__tests__/*
```

**Passi:** implementare registry, normalizzazione `purposeKey`, policy errors, slot validation,
serializzazione JSON safe (`<`, U+2028, U+2029), runtime DOM e idempotenza. Nessun adapter di rete.

**Test:** policy per ogni purpose, sensitive field rejection, slot missing/unknown/duplicate,
escaping `</script>`, mount twice, accessibility markup e no raw user HTML.
**Acceptance:** input uguale produce output byte-stabile; nessuna dipendenza infra.
**Stop:** runtime richiede React/Next o una dipendenza browser non disponibile nello ZIP.

### W4 — Project settings + adapter mailto

**Tier:** L1.
**File target:** `Project.ts`, repository interface/Mongo, contratti forms settings, use case
GET/PUT, nuova route owner, `app.ts`, runtime mailto e test.

**Passi:**

1. Estendere Project in modo additivo.
2. Generare `publicKey` lazy e stabile.
3. Implementare resolution: project recipient → email owner; non modificare l'account user.
4. Validare URL informativa HTTPS in produzione e retention clamp.
5. Risolvere `PlatformConfig.formPolicy` con default retrocompatibili e impedire che l'override
   progetto allarghi i limiti piattaforma.
6. Route protetta con auth + sandbox; verificare che `:projectId` coincida con `x-project-id`.
7. Registrare owner/settings routes in `app.ts` prima di `createProjectRoutes()`: quel router usa
   middleware globale e l'ordine è un vincolo già documentato per le route pubbliche.
8. Integrare `mailto` e fallback copy.

**Test:** accesso owner, 401, 403 cross-user, mismatch header/path, default legacy, RFC encoding,
CRLF injection, long body fallback, state “draft opened”.
**Acceptance:** form mailto funziona in preview e in HTML standalone senza API.
**Stop:** un route handler accede direttamente a Mongo o il recipient viene scelto dall'LLM.

### W5 — Preview, publish e ZIP export

**Tier:** L1.
**File target:** punto comune di preparazione artefatto, `PublishProject.ts`, `ExportLayer1Zip.ts`,
preview resolution, test guardrail.

**Passi:**

1. Definire una sola funzione `prepareArtifactForms()` chiamata da preview/publish/export.
2. Compilazione idempotente con marker versionati.
3. Publish usa manifest dello snapshot selezionato.
4. ZIP include `serviceManifest.json`, runtime locale e README con modalità/limiti.
5. Se `relay/capture` e origin export non configurato, export continua ma README e UI mostrano
   “configurazione dominio richiesta”; non degradare silenziosamente a mailto.
6. Non toccare `GrapesJsEditorPanel.tsx` o componenti Monaco.

**Test:** no manifest unchanged, valid manifest compiled, invalid placeholder blocked, publish path,
ZIP file list, repeat compilation no duplicate runtime, unresolved recipient blocks mailto publish.
**Acceptance:** stesso snapshot produce form equivalente nei tre canali.
**Stop:** vengono creati tre compiler diversi o il codice modifica media guardrails esistenti.

### W6 — SMTP profiles e relay stateless

**Tier:** L2; implementazione economica ammessa, review security obbligatoria.
**Dipendenze:** aggiungere `nodemailer`, tipi, `redis`; aggiornare lockfile tramite npm workspace.

**Nuovi componenti:** entity/repository profile, `IEmailDeliveryService` domain port, adapter
Nodemailer, SMTP host policy, Redis limiter, CRUD/verify use cases, public submit use case/routes.

**Passi sensibili:**

1. Estendere `CryptoService` con context default compatibile e test decrypt fixture preesistente.
2. DTO sempre redatto.
3. Implementare policy anti-SSRF §11.3 prima di `verify` o send.
4. Nodemailer: `secure=true` per 465; STARTTLS required e certificato verificato per 587.
5. `from` configurato; visitor email solo `replyTo` dopo validation.
6. Redis fail-closed in production.
7. Registrare `publicFormRoutes` prima di `createProjectRoutes()` e prima di qualunque router con
   `router.use(authMiddleware)` globale; la route pubblica non deve attraversare JWT auth.
8. Public route risolve project/snapshot/form, origin e policy prima di decifrare password.
9. `relay` invia e scarta values; logga solo project/form/result/duration/ipHash.

**Test:** crypto backward compatibility/context separation, DTO leak scan, SSRF IPv4/IPv6/DNS,
TLS mapping, owner isolation, CORS, rate limits, payload limit, extra field drop, SMTP failure
redaction, no submission repository call. Usare fake adapter SMTP, mai credenziali reali.
**Acceptance:** relay invia con fake adapter, nessun payload persiste/logga.
**Stop:** review security non disponibile; host privato accettato; plaintext mode; Redis bypass in prod.

### W7 — Capture inbox e double opt-in

**Tier:** L2 con review privacy/security.
**Componenti:** entity/repository submission, capture use case, list/detail/delete owner use cases,
TTL indexes, token hash, confirmation/double-opt-in flow.

**Passi:**

1. Persistenza solo dopo validation, policy e rate limit.
2. Calcolare `expiresAt` lato server.
3. Evidence privacy/marketing da controlli manifest, mai da hidden field libero.
4. Newsletter inizialmente `pending`; inviare link one-time con token plaintext solo via email.
5. Salvare hash token, expiry e status; conferma idempotente.
6. Owner list con paginazione, field allowlist e CSV export fuori scope v1.
7. Delete fisica della submission; audit senza values.

**Test:** TTL/index, retention clamp, contact without marketing, newsletter pending/confirm/expire,
token replay, cross-project reads/deletes, relay still stateless.
**Acceptance:** prova consenso coerente e owner isolation.
**Stop:** consenso viene inferito dall'invio; token plaintext persistito; query non filtra project+owner.

### W8 — UI configurazione

**Tier:** L1.
**File nuovi preferiti:** componenti sotto `apps/web/components/forms/` e client sotto
`apps/web/lib/api/forms.ts`; wiring minimo nella superficie settings/progetto esistente.

UI progetto:

- switch enabled;
- modalità mailto/relay/capture con spiegazione chiara;
- recipient, informativa, retention e confirmation/double-opt-in condizionali;
- stato “email pubblica nel mailto”;
- test runtime form con dati fittizi, senza invio reale.

UI profili:

- host, 465/587, TLS mode derivato/coerente, username, password write-only, from;
- status verified/failed, test connection, rotate password, disable/delete;
- mai mostrare password o ciphertext.

UI superadmin policy:

- estendere la superficie `PlatformConfig` esistente, non creare una seconda area admin;
- consentire solo valori entro gli hard max code-side;
- non offrire controlli per disabilitare TLS, sandbox, forbidden sensitive fields o redazione log;
- mostrare chiaramente quali modalità sono abilitate globalmente.

Regole frontend AGENTS: shadcn `Input/Button/Label`, Tailwind semantic tokens, `cn`, nessun inline
style nuovo, nessun raw input/button/label.
**Test:** component states, API errors redatti, role visibility, responsive, keyboard/a11y.
**Acceptance:** utente configura mailto senza conoscere SMTP; campi avanzati appaiono solo quando
necessari.
**Stop:** UI salva segreti in localStorage o duplica configurazione admin/user in due shell.

### W9 — Prompt/Layer S, E2E, docs e rollout

**Tier:** L0/L1.

1. Aggiornare `form-ux-validation.md`: slot, manifest, privacy controls distinti e adapter states.
2. Non modificare `ProjectPreset.ts` se non necessario; una modifica richiede reseed preset secondo
   `AGENT_RELEASE_CHECKLIST.md`.
3. E2E:
   - prompt → valid service manifest → snapshot;
   - preview mailto e fallback;
   - export ZIP e runtime;
   - publish origin auto-allowlist;
   - relay fake SMTP;
   - capture/contact;
   - newsletter double opt-in.
4. Aggiornare nella stessa change:
   - `docs/INDEX.md`;
   - `docs/architecture/BOOTSTRAP_ARCHITECTURE.md`;
   - `docs/runbooks/TESTABLE_STEPS.md`;
   - `docs/specs/BAAS_SERVICES_SPEC.md` con nota di allineamento/supersessione puntuale;
   - `.env.example` e config docs per Redis/SMTP policy;
   - README/CONTRIBUTING solo se il flusso contributor cambia.
5. Nessun Docker restart finché non richiesto. Prima verificare lo stack e usare `--no-deps` sul
   solo servizio API corretto.

**Acceptance:** DoD §17 e nessuna regressione R2/R3.
**Stop:** E2E richiede credenziali reali o riavvio Mongo/Redis.

---

## 14. File map finale prevista

```text
packages/contracts/src/
  serviceManifest.ts
  forms.ts

apps/api/src/domain/entities/
  Project.ts                       # serviceConfig additivo
  EmailDeliveryProfile.ts
  FormSubmission.ts

apps/api/src/domain/repositories/
  EmailDeliveryProfileRepository.ts
  FormSubmissionRepository.ts

apps/api/src/application/forms/
  standardFieldCatalog.ts
  formPolicyRegistry.ts
  ValidateServiceManifest.ts
  ResolveProjectFormSettings.ts
  FormRuntimeCompiler.ts
  SubmitPublicForm.ts
  ListFormSubmissions.ts
  DeleteFormSubmission.ts
  ConfirmNewsletterOptIn.ts

apps/api/src/domain/services/
  IEmailDeliveryService.ts
  IFormRateLimitStore.ts

apps/api/src/infra/email/
  NodemailerEmailDeliveryService.ts
  smtpHostPolicy.ts

apps/api/src/infra/rate-limit/
  RedisFormRateLimitStore.ts
  MemoryFormRateLimitStore.ts       # test/dev only

apps/api/src/infra/repositories/
  MongoEmailDeliveryProfileRepository.ts
  MongoFormSubmissionRepository.ts

apps/api/src/presentation/http/routes/
  formServiceRoutes.ts              # owner
  publicFormRoutes.ts               # anonymous, hardened
  emailDeliveryProfileRoutes.ts

apps/web/components/forms/
  ProjectFormSettingsPanel.tsx
  EmailDeliveryProfilesPanel.tsx

apps/web/lib/api/forms.ts
tests/e2e/forms-*.spec.ts
```

Se durante l'esecuzione esiste già un file con la stessa responsabilità, riusarlo e annotare la
deviazione; non creare duplicati solo per seguire il nome suggerito.

---

## 15. Comandi di verifica

Dopo ogni wave, usare il sottoinsieme pertinente:

```bash
npm run build -w packages/contracts
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npm run test -w apps/api -- serviceManifest
npm run test -w apps/api -- FormRuntime
npm run test -w apps/api -- formService
npm run test -w apps/api -- PublishExport
```

Prima di test Docker:

```bash
docker ps --format '{{.Names}}'
```

Poi scegliere una sola stack. Non usare `down`. Per ricreare solo API:

```bash
docker compose -f docker-compose.deploy.yml up -d --no-deps api
```

oppure, solo se è attiva la dev stack:

```bash
docker compose up -d --no-deps api
```

Browser E2E solo dopo unit/integration verdi. Usare dati e artefatti sotto `tests/`; output in
directory gitignored.

---

## 16. Rollout e rollback

### 16.1 Feature flags

```text
FORM_RUNTIME_ENABLED=false
FORM_MAILTO_ENABLED=true
FORM_BAAS_PUBLIC_API_ENABLED=false
FORM_RELAY_ENABLED=false
FORM_CAPTURE_ENABLED=false
FORM_DOUBLE_OPT_IN_ENABLED=false
```

I default di produzione durante rollout tengono spenti public API/capture. Il manifest può essere
parsato e persistito prima che l'esecuzione sia abilitata.

### 16.2 Ordine rollout

1. contracts/parser shadow mode;
2. snapshot persistence;
3. mailto su progetti test;
4. mailto opt-in generale;
5. relay su allowlist progetti;
6. capture su allowlist;
7. newsletter double opt-in;
8. general availability dopo osservabilità e abuse review.

### 16.3 Rollback

- spegnere il flag dell'adapter, senza rimuovere manifest/snapshot fields;
- non eliminare collection durante rollback applicativo;
- mailto può restare fallback solo se configurato esplicitamente, mai degradazione nascosta da
  relay/capture;
- public key rotation non è rollback; invalida client e richiede republish;
- migrazioni sono additive e idempotenti; nessun downgrade distruttivo.

---

## 17. Definition of Done

### Contratto e determinismo

- [ ] `serviceManifest-v1` strict, versionato e testato con provider output imperfetto.
- [ ] Manifest e snapshot restano allineati 1:1.
- [ ] LLM emette slot + manifest e non submit handler custom.
- [ ] Runtime idempotente e uguale in preview/publish/export.

### Sicurezza e isolamento

- [ ] Owner APIs applicano auth + double sandbox.
- [ ] Public routes applicano key resolution, exact origin, Redis limiter e payload limits.
- [ ] SMTP TLS-only e anti-SSRF verificato IPv4/IPv6.
- [ ] Nessun secret o form value in response/log/error.
- [ ] Cross-user/project integration tests verdi.

### Privacy

- [ ] Mailto descritto correttamente come non-persistente per la piattaforma.
- [ ] Marketing consent separato dalla richiesta di contatto.
- [ ] Dati particolari bloccati dalla policy default.
- [ ] Capture applica retention e cancellazione.
- [ ] Newsletter resta pending fino al double opt-in.

### UX e portabilità

- [ ] Keyboard, label, error, progress, loading e success state accessibili.
- [ ] Mailto offre fallback copy/manuale.
- [ ] ZIP contiene manifest/runtime/README.
- [ ] UI usa shadcn e semantic tokens.

### Operazioni

- [ ] ExecutionLog contiene esito/durata senza payload.
- [ ] Feature flags e rollback verificati.
- [ ] Docs index, architecture e runbook aggiornati.
- [ ] Nessun Mongo/Redis restart non necessario.
- [ ] Nessun file scratch lasciato nel root.

---

## 18. Fuori scope v1

- IMAP, lettura inbox e sincronizzazione risposte;
- allegati/upload nei form;
- pagamenti o dati carta;
- form sanitari, legali o contenenti categorie particolari;
- builder visuale drag-and-drop del manifest;
- automazioni CRM, n8n/Make e webhook;
- analytics comportamentali o fingerprinting visitatori;
- CSV export submission;
- provider email API diversi da SMTP;
- traduzione automatica dell'informativa legale;
- promessa di conformità GDPR automatica.

IMAP potrà essere valutato solo con una spec separata di inbound processing, OAuth provider,
retention, threading e malware handling. Non aggiungere password IMAP al profilo SMTP “per
completezza”.

### 18.1 Evoluzione dopo `capture`

Il form inbox è il banco di prova della piattaforma capability, non un'implementazione isolata.
Dopo i gate privacy/security di W7, riusare scope, policy, outbox e audit in questo ordine:

1. notifiche email/Telegram originate da eventi interni, mai da trigger anonimi generici;
2. automazioni schedulate, riepiloghi periodici e stato retry/dead-letter;
3. connector CRM/webhook con HMAC, secrets server-side e policy anti-SSRF;
4. AI enrichment tracciabile: classificazione, deduplica, lead scoring e report periodici;
5. collection strutturate con schema versionato e CRUD owner, senza query Mongo arbitrarie;
6. storage, membri/auth e pagamenti solo con review dedicate.

La roadmap, il modello multi-tenant e i gate completi sono definiti in
[PLATFORM_CAPABILITY_RUNTIME.md](../architecture/PLATFORM_CAPABILITY_RUNTIME.md).

---

## 19. Handoff template per ogni task card

Il modello esecutore deve chiudere ogni card con questo formato:

```text
Wave:
Scope completato:
File modificati:
Test eseguiti e risultato:
Acceptance checks:
Deviazioni dal piano (con motivo):
Rischi residui:
Stop condition incontrati:
Prossima wave sbloccata: sì/no
```

Non marcare una wave completa se un test richiesto non è stato eseguito. Un failure preesistente
deve essere riportato con evidenza e separato dalle regressioni introdotte dalla wave.
