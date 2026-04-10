# Andy Code Cat — UX Review + Pubblicazione Persistente (Path UUID)

> **Revisione:** 2026-04-07
> **Scope:** Review UX workspace + Implementazione publishing persistente livello 3 (path UUID)
> **Prerequisiti:** M0, M0.5, M0.8, M4a completati

---

## 1. UX Review — Stato Attuale del Workspace

### 1.1 Flusso utente attuale

```
Login → Dashboard (lista progetti) → Crea/Apri progetto → Workspace
```

Il workspace è un layout 3-colonne:

| Colonna | Contenuto | Stato |
|---|---|---|
| **Sinistra** (chat) | Chat con LLM, focus indicator, prompt config | ✅ Funzionante |
| **Centro** (preview) | Preview iframe, tabs (HTML/CSS/JS/Prompt), toolbar con Inspect/Edit/Export/Capture | ✅ Funzionante |
| **Destra** (editor) | Monaco editor per sorgente, snapshot history | ✅ Funzionante |

### 1.2 Pain points UX identificati

#### P1 — Nessun percorso "pubblica e condividi"

L'utente genera un sito, lo affina, ma poi può solo scaricare un ZIP. Non può mostrarlo a qualcuno con un link. Questo rompe il loop di validazione: generare → testare → condividere → iterare.

#### P2 — Inspect mode non è il default dopo la prima generazione

Il focus edit è la feature più potente per risparmiare token, ma richiede attivazione manuale. L'utente novizio non sa che esiste.

#### P3 — Toolbar troppo densa

Inspect, Edit, Salva Edit, Export ZIP, Cattura JPG/PDF — tutti sulla stessa riga. Manca gerarchia visiva.

#### P4 — Nessun feedback post-generazione

Dopo che l'LLM genera, non c'è un call-to-action chiaro: "Il tuo sito è stato generato! Vuoi pubblicarlo o affinarlo?"

#### P5 — Manca un'area "stato pubblicazione"

Quando il sito sarà pubblicato, l'utente deve vedere lo stato del deploy e il link condivisibile in modo prominente.

### 1.3 Miglioramenti UX proposti (incrementali)

| ID | Miglioramento | Priorità | Sprint |
|---|---|---|---|
| **UX-PUB** | Bottone "Pubblica" + pannello link condivisibile | **Critica** | Questo sprint |
| **UX-POST-GEN** | Banner post-generazione con CTA ("Pubblica" / "Affina con Inspect") | Alta | Prossimo sprint |
| **UX-INSPECT-AUTO** | Auto-attivazione Inspect dopo prima generazione | Alta | Prossimo sprint |
| **UX-TOOLBAR** | Raggruppamento toolbar: [Modalità] [Azioni] [Pubblicazione] | Media | Futuro |

---

## 2. Pubblicazione Persistente — Architettura "Livello 3" (Path UUID)

### 2.1 Motivazione

La spec originale (`EXPORT_AND_PUBLISH_SPEC.md`) definisce un sistema subdomain-based con nginx dedicato (M4b). È il target finale, ma richiede:

- Servizio nginx in docker-compose
- Docker socket per reload
- Wildcard DNS/SSL
- BullMQ per DeployWorker

**Livello 3** è un approccio intermedio: l'API stessa serve le pagine pubblicate a un path UUID, senza nessuna infrastruttura aggiuntiva.

```
Livello 1: ZIP Export (download locale)         ✅ Implementato
Livello 2: Pubblicazione path UUID (API-served)  ← QUESTO SPRINT
Livello 3: Subdomain nginx (futuro M4b)          📐 Spec definita
```

### 2.2 URL Format

```
https://{host}/p/{publishId}
```

Esempi:

- Dev: `http://localhost:4000/p/a1b2c3d4`
- Prod: `https://api.Andy Code Cat.io/p/a1b2c3d4`

Il `publishId` è un short-id derivato da UUID (primi 8 caratteri) con collision check.

### 2.3 Flusso utente

```
1. Utente soddisfatto della preview
2. Clicca "🌐 Pubblica"
3. API copia artefatti in /data/www/{publishId}/
4. Ritorna URL condivisibile
5. UI mostra link con bottone "Copia link"
6. Il visitatore apre il link → vede il sito generato
7. L'utente può aggiornare (re-publish) o rimuovere la pubblicazione
```

### 2.4 Differenze dal ZIP Export

| Aspetto | ZIP Export | Publish Path UUID |
|---|---|---|
| Output | File scaricato | URL live condivisibile |
| Durata | Fino a download | Persistente (finché non rimosso) |
| Aggiornamento | Nuovo export | Re-publish sovrascrive |
| Dipendenze infra | Nessuna | Solo filesystem (`/data/www/`) |
| Auth visitatore | N/A | Nessuna (pubblico) |

---

## 3. Design tecnico

### 3.1 Entità `SiteDeployment`

```typescript
interface SiteDeployment {
    id: string;                    // UUID
    publishId: string;             // short-id (8 chars, URL-safe)
    projectId: string;
    userId: string;
    snapshotId: string;
    status: "deploying" | "live" | "failed";
    url: string;                   // /p/{publishId}
    filesDeployed: string[];       // ['index.html', 'style.css', 'script.js']
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
    deployedAt?: Date;
}
```

### 3.2 Repository `SiteDeploymentRepository`

```typescript
interface SiteDeploymentRepository {
    create(input: CreateSiteDeploymentInput): Promise<SiteDeployment>;
    findById(id: string): Promise<SiteDeployment | null>;
    findByPublishId(publishId: string): Promise<SiteDeployment | null>;
    findByProjectId(projectId: string): Promise<SiteDeployment[]>;
    findActiveByProjectId(projectId: string): Promise<SiteDeployment | null>;
    updateStatus(id: string, status: SiteDeployment["status"], data?: Partial<SiteDeployment>): Promise<SiteDeployment | null>;
    deleteById(id: string): Promise<boolean>;
    isPublishIdTaken(publishId: string): Promise<boolean>;
}
```

### 3.3 Use-case `PublishProject`

```
Input: { projectId, userId, snapshotId? }
Output: SiteDeployment con URL

Steps:
1. Verifica double sandbox (user owns project)
2. Recupera snapshot (by ID o active)
3. Se esiste già un deploy live per il progetto → aggiorna (re-publish)
4. Genera publishId unique (short UUID, collision check)
5. Post-processa artefatti (stessa logica di ExportLayer1Zip: separa CSS/JS)
6. Scrivi file in /data/www/{publishId}/
7. Crea/aggiorna record SiteDeployment
8. Ritorna deployment con URL
```

### 3.4 Use-case `UnpublishProject`

```
Input: { projectId, userId, deploymentId }
Output: void

Steps:
1. Verifica ownership
2. Cancella directory /data/www/{publishId}/
3. Aggiorna/elimina record SiteDeployment
```

### 3.5 API Endpoints

```
POST   /v1/projects/:projectId/publish        → Pubblica/aggiorna
GET    /v1/projects/:projectId/publish         → Stato pubblicazione corrente
DELETE /v1/projects/:projectId/publish/:id     → Rimuovi pubblicazione

GET    /p/:publishId                           → Serve index.html (PUBBLICO)
GET    /p/:publishId/style.css                 → Serve CSS (PUBBLICO)
GET    /p/:publishId/script.js                 → Serve JS (PUBBLICO)
GET    /p/:publishId/*                         → Serve qualsiasi file (PUBBLICO)
```

### 3.6 Contratto Zod

```typescript
// packages/contracts/src/publish.ts
const publishProjectSchema = z.object({
    snapshotId: z.string().uuid().optional(),
});

interface SiteDeploymentDto {
    id: string;
    publishId: string;
    projectId: string;
    status: "deploying" | "live" | "failed";
    url: string;
    filesDeployed: string[];
    createdAt: string;
    updatedAt: string;
    deployedAt?: string;
}
```

### 3.7 Security

- **Serving pubblico**: il path `/p/:publishId` non richiede autenticazione
- **Contenuto sanitizzato**: gli artefatti HTML sono quelli generati dall'LLM, già nel sistema
- **Path traversal prevention**: `publishId` validato come `[a-z0-9]` only, nessun input utente nel path
- **Double sandbox**: POST/DELETE richiedono auth + project ownership
- **No directory listing**: solo file specifici serviti, mai `readdir`

### 3.8 Storage layout

```
data/
├── www/
│   ├── {publishId_1}/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── script.js
│   └── {publishId_2}/
│       ├── index.html
│       ├── style.css
│       └── script.js
├── uploads/          ← asset esistenti
└── exports/          ← ZIP export esistenti
```

---

## 4. UI Frontend — Componenti

### 4.1 Bottone "Pubblica" nella toolbar

Posizionato dopo Export ZIP nella toolbar della preview. Visibile solo quando ci sono artefatti.

```
[◎ Inspect] [✎ EDIT] [💾 Salva] | [⬇ ZIP] [📷 Cattura] [🌐 Pubblica]
```

### 4.2 Pannello stato pubblicazione

Quando il progetto è pubblicato, mostra un banner sotto la toolbar:

```
┌──────────────────────────────────────────────────────┐
│ 🌐 Pubblicato: http://localhost:4000/p/a1b2c3d4      │
│ [📋 Copia link]  [🔄 Aggiorna]  [🗑 Rimuovi]         │
│ Ultimo aggiornamento: 5 min fa                        │
└──────────────────────────────────────────────────────┘
```

### 4.3 Flusso "Pubblica" (prima volta)

1. Utente clicca "🌐 Pubblica"
2. Notification panel: "Pubblicazione in corso…"
3. API risponde con URL
4. Banner pubblicazione appare con il link
5. Notification: "Sito pubblicato! Link copiato."

### 4.4 Flusso "Aggiorna" (re-publish)

1. Utente modifica il sito (chat, edit, ecc.)
2. Clicca "🔄 Aggiorna" nel banner pubblicazione
3. API sovrascrive i file
4. Banner aggiornato con nuovo timestamp

---

## 5. Sequenza implementazione

```
1. Contracts: packages/contracts/src/publish.ts
2. Entity + Repository interface: domain/entities/SiteDeployment.ts, domain/repositories/SiteDeploymentRepository.ts
3. MongoDB adapter: infra/repositories/MongoSiteDeploymentRepository.ts
4. LocalFileStorage: aggiungere metodi publish (wwwDirPath, writePublishFiles, deletePublishDir)
5. Use-cases: PublishProject.ts, UnpublishProject.ts, GetSiteDeployment.ts
6. Routes: publishRoutes.ts (CRUD + static serving)
7. app.ts: montare routes
8. Frontend: api.ts functions, workspace UI (bottone + banner)
9. Test smoke
```

---

## 6. Compatibilità con evoluzione futura

Questo livello 3 è compatibile con l'evoluzione verso subdomain nginx (M4b):

- `SiteDeployment` entity è la stessa — si aggiunge `type: "path" | "subdomain"`
- Lo storage `/data/www/{publishId}/` è lo stesso usato da nginx
- Il passaggio a nginx richiede solo: aggiungere virtual host + cambiare URL format

Non ci sono breaking changes quando si evolve verso il livello successivo.
