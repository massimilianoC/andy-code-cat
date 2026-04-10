# Andy Code Cat — Export, Asset Management & Web Publishing Spec

> **Aggiornato:** architettura modulare e layer-aware. Feature A (Asset Manager) e Feature B1 (Layer 1 ZIP Export) sono indipendenti da M3 e implementabili nell'MVP corrente.
> **NGINX:** istanza dedicata nel cluster Docker per controllo completo dei virtual host dinamici (M4b)

---

## Principi architetturali

### Double Sandbox obbligatoria

**Tutte** le operazioni su file (upload, download, export, delete) passano per il doppio sandbox:

1. **User sandbox**: `jwt.sub` → `userId` autenticato.
2. **Project sandbox**: header `x-project-id` → progetto verificato con `project.ownerUserId == jwt.sub`.

Il filesystem riflette questa struttura: `/data/uploads/{userId}/{projectId}/` e `/data/exports/{userId}/{projectId}/`. I path sono costruiti esclusivamente da valori verificati — mai da input utente raw (prevenzione path traversal).

### Export context-aware per layer

| Layer | Sorgente | Output | Stato |
|---|---|---|---|
| **Layer 1** — Chat Preview | `PreviewSnapshot.artifacts` (HTML/CSS/JS) | ZIP con file separati | **MVP** |
| **Layer 2** — GenerationWorker | `dist/` da OpenCode | ZIP file tree | Futuro M4a v2 |

L'astrazione è `ExportRecord.sourceType: 'layer1_snapshot' \| 'layer2_dist' \| ...` — extendable senza breaking changes.

### Asset Manager disaccoppiato dall'Export

- **Project Asset Manager**: file di riferimento caricati dall'utente (PDF brief, immagini brand, markdown spec). Input per lo sviluppo, non output.
- **Export System**: output generati dal sistema (ZIP sito). Usa lo stesso storage infra ma è un sistema separato.

---

## Indice

1. [Feature A — Project Asset Manager](#feature-a--project-asset-manager)
2. [Feature B — Export Layer-Aware](#feature-b--export-layer-aware)
3. [Feature B1 — Layer 1 ZIP Export (MVP)](#feature-b1--layer-1-zip-export-mvp)
4. [Feature 2 — Web Publishing con NGINX](#feature-2--web-publishing-con-nginx)
5. [MongoDB Schemas](#mongodb-schemas)
6. [Storage Layout FileSystem](#storage-layout-filesystem)
7. [NGINX nel cluster Docker](#nginx-nel-cluster-docker)
8. [Sequenza di sviluppo e dipendenze](#sequenza-di-sviluppo-e-dipendenze)

---

## Feature A — Project Asset Manager

### A.1 Obiettivo

Ogni progetto può avere file di riferimento caricati dall'utente: brief PDF, immagini brand, font, spec markdown, snippet di codice. Usati come contesto per lo sviluppo (passabili come riferimento alle prompt LLM) ma non sono output del sistema.

### A.2 Tipi di file accettati

| Categoria | MIME types | Max size |
|---|---|---|
| Immagini | `image/*` | 10 MB |
| Documenti | `application/pdf` | 20 MB |
| Testo / Codice | `text/*`, `application/json` | 5 MB |

Limite totale per progetto: **100 MB**. Max file per progetto: **50**.

### A.3 API Endpoints

Tutti richiedono `Authorization: Bearer <token>` + header `x-project-id`.

```
POST   /v1/projects/:projectId/assets
GET    /v1/projects/:projectId/assets
DELETE /v1/projects/:projectId/assets/:assetId
GET    /v1/projects/:projectId/assets/:assetId/download
```

### A.4 Entity

```typescript
interface ProjectAsset {
  id: string;              // UUID
  projectId: string;
  userId: string;
  originalName: string;    // sanitizzato in visualizzazione
  storedFilename: string;  // {assetId}-{safeFilename} — usato nel path FS
  mimeType: string;
  fileSize: number;        // bytes
  createdAt: Date;
}
```

Storage path: `/data/uploads/{userId}/{projectId}/{storedFilename}`

---

## Feature B — Export Layer-Aware

### B.1 ExportRecord (astrazione comune)

```typescript
export type ExportSourceType = 'layer1_snapshot'; // | 'layer2_dist' in futuro

interface ExportRecord {
  id: string;
  projectId: string;
  userId: string;
  sourceType: ExportSourceType;
  snapshotId?: string;           // per sourceType: 'layer1_snapshot'
  status: 'pending' | 'ready' | 'failed';
  fileSize?: number;
  fileSha256?: string;
  filesIncluded: string[];
  assetPlaceholders: AssetPlaceholder[];
  downloadCount: number;
  expiresAt: Date;               // TTL MongoDB per cleanup automatico (24h)
  errorMessage?: string;
  createdAt: Date;
  readyAt?: Date;
}
```

### B.2 Download token JWT

```typescript
// payload
{
  sub: exportId,
  userId: string,
  projectId: string,
  iat: number,
  exp: number     // iat + EXPORT_DOWNLOAD_TTL (default: 3600s)
}
```

Firmato con `EXPORT_JWT_SECRET` (separato da JWT auth). Il download endpoint verifica solo il JWT, senza accesso al DB ad ogni richiesta.

### B.3 Download endpoint (pubblico — solo JWT)

```
GET /v1/download/:token
```

- Verifica JWT con `EXPORT_JWT_SECRET`
- Path FS risolto da `exportId` + `userId` + `projectId` estratti dal payload JWT — **mai da input raw**
- Se file non trovato → 410 Gone (export scaduto/cleanup)
- Stream ZIP con `Content-Disposition: attachment`

```
GET /v1/exports/:exportId
```

Richiede auth. Ritorna stato export per polling.

---

## Feature B1 — Layer 1 ZIP Export (MVP)

### B1.1 Obiettivo

L'utente, soddisfatto della preview chat, scarica un ZIP pronto per deploy. **Indipendente da M3:** usa solo `PreviewSnapshot.artifacts` già in MongoDB.

### B1.2 Struttura ZIP

```
{project-slug}/
├── index.html        ← con <link> e <script src> per file separati
├── style.css         ← CSS estratto e merged
├── script.js         ← JS estratto e merged
├── assets/           ← placeholder stub se identificati
└── README.md         ← istruzioni + lista placeholder
```

### B1.3 Post-processor artefatti

1. **Estrai CSS inline** (`<style>` tag) → merge in `style.css` → sostituisce con `<link rel="stylesheet" href="style.css">` in `<head>`
2. **Estrai JS inline** (`<script>` senza `src`) → merge in `script.js` → sostituisce con `<script src="script.js"></script>` prima di `</body>`
3. **Merge con artifacts**: CSS/JS separati dall'artifact (già presenti) sono prepended al contenuto estratto dall'HTML
4. **Identificatori placeholder**: `<img src="">`, `<img src="placeholder*">`, `url('')` in CSS, commenti `/* replace: */` → `assetPlaceholders[]`

### B1.4 API

```
POST /v1/projects/:projectId/export/layer1
```

**Body opzionale:** `{ snapshotId?: string }`

**Response 201:**

```typescript
{
  exportId: string;
  downloadToken: string;
  downloadUrl: string;       // /v1/download/{token}
  expiresAt: string;         // ISO8601
  filesIncluded: string[];
  assetPlaceholders: AssetPlaceholder[];
}
```

### B1.5 Testable Steps

```
1. POST /v1/projects/:id/export/layer1
   → 201 { exportId, downloadUrl }

2. GET {downloadUrl}
   → ZIP con index.html, style.css, script.js, README.md

3. index.html non ha <style> inline, ha <link href="style.css">
   non ha <script> inline, ha <script src="script.js">

4. Token scaduto → 401

5. ExportRecord in MongoDB: status 'ready', fileSha256 presente

6. GET /v1/exports/:exportId → { status: 'ready', downloadCount: 1 }
```

---

## Feature 1 — ZIP Export (Layer 1, sezione originale)

> **Questa sezione è mantenuta come riferimento storico.**
> La specifica aggiornata è in [Feature B1](#feature-b1--layer-1-zip-export-mvp).

---

---

## 1. Feature 1 — ZIP Export

### 1.1 Obiettivo

L'utente, soddisfatto della preview generata, può scaricare un pacchetto ZIP completo e pronto per il deploy manuale su qualsiasi server. Nessuna dipendenza da Andy Code Cat dopo il download.

### 1.2 Struttura del pacchetto ZIP

```
{project-slug}/
├── index.html
├── style.css
├── script.js
├── assets/
│   ├── placeholder-hero.jpg    ← mock image (da sostituire)
│   ├── placeholder-about.jpg   ← mock image
│   └── logo.svg                ← mock icon/SVG
└── README.md
```

**README.md generato dinamicamente** — contiene:

- Nome progetto e data export
- Istruzioni deploy (aprire index.html direttamente o su NGINX/Apache)
- Lista asset da sostituire con path, dimensioni raccomandate e contesto d'uso
- Link alla documentazione Andy Code Cat

**Convenzioni file:**

- CSS e JS sono sempre file separati (non inline nell'HTML), anche se l'LLM li ha prodotti inline: il post-processor li estrae.
- I placeholder asset hanno nomi semantici (`placeholder-{sezione}.{ext}`) per aiutare l'utente a capire cosa sostituire.

### 1.3 API Endpoint

```
POST /v1/projects/:id/export/zip
```

**Body (opzionale):**

```typescript
{
  snapshotId?: string;   // se omesso, usa l'ultimo snapshot disponibile
}
```

**Response (202 Accepted):**

```typescript
{
  exportId: string;
  downloadToken: string;    // JWT firmato, TTL 1h
  downloadUrl: string;      // /v1/download/:token
  expiresAt: string;        // ISO8601
}
```

**Download endpoint:**

```
GET /v1/download/:token
```

Verifica il JWT, streamma il file ZIP con `Content-Disposition: attachment`. Una volta scaricato, il token non viene invalidato (può essere scaricato più volte finché non scade). Il file sul filesystem viene pulito dopo 24h tramite job di cleanup.

### 1.4 Logica di generazione ZIP

```typescript
// apps/api/src/application/use-cases/ExportProjectZip.ts
class ExportProjectZip {
  async execute(projectId, snapshotId?, userId): Promise<ExportRecord> {
    // 1. Recupera snapshot (o ultimo da conversazione)
    // 2. Estrai HTML/CSS/JS dagli artifacts
    // 3. Post-processing:
    //    - Separa CSS/JS inline in file dedicati se necessario
    //    - Aggiorna <link> e <script> nell'HTML
    //    - Identifica placeholder asset (src vuoti, placeholder URLs, mock data)
    // 4. Genera README.md con lista asset
    // 5. Crea ZIP in /data/exports/{exportId}.zip
    // 6. Calcola fileSize e SHA-256 checksum
    // 7. Genera signed JWT per download
    // 8. Salva ExportRecord in MongoDB
    // 9. Ritorna ExportRecord
  }
}
```

**Post-processor — separazione CSS/JS:**

- Cerca `<style>` tag nell'HTML → estrae in `style.css` + aggiunge `<link rel="stylesheet" href="style.css">`
- Cerca `<script>` tag inline nell'HTML → estrae in `script.js` + aggiunge `<script src="script.js"></script>`
- Le direttive `@import` CSS vengono lasciate intatte

**Post-processor — identificazione asset:**

- Cerca `<img src="">` con src vuoti o placeholder-like
- Cerca `url('')` nel CSS con valori vuoti o placeholder
- Cerca commenti `/* replace: ... */` inseriti dall'LLM
- Genera lista in README.md con: path nell'HTML/CSS, dimensioni raccomandate, contesto ("immagine hero sezione about")

### 1.5 Export come generazione sincrona vs asincrona

Per MVP: **sincrona** (attesa < 2s per progetti tipici).
Se `dist/` supera 10MB → risponde 202 con `status: "pending"` e coda job BullMQ.
L'utente fa polling su `GET /v1/exports/:exportId` finché `status: "ready"`.

### 1.6 Signed JWT per download

```typescript
// payload
{
  sub: exportId,
  userId: string,
  projectId: string,
  iat: number,
  exp: number    // +3600s (1h)
}
```

Firmato con `EXPORT_JWT_SECRET` (separato dal JWT di auth). Verificato nel middleware del download endpoint senza accesso al DB.

---

## 2. Feature 2 — Web Publishing con NGINX

### 2.1 Due modalità di pubblicazione

| Modalità | Subdomain | TTL | Disponibilità | Caso d'uso |
|---|---|---|---|---|
| **Random** | `{adjective}-{noun}-{N}.Andy Code Cat.io` | 24h | Sempre disponibile | Condivisione rapida, demo temporanea |
| **Reserved** | `{nome-scelto}.Andy Code Cat.io` | Nessuno | Se non già preso | Sito persistente, condivisione branded |

### 2.2 Subdomain Random (Feature 2a — prima priorità MVP)

**Flusso utente:**

1. Utente clicca "Pubblica anteprima temporanea"
2. Sistema genera subdomain random univoco (wordlist + numero)
3. Copia `dist/` in `/var/www/Andy Code Cat/{subdomain}/`
4. Scrive `nginx.conf` per il virtual host
5. Esegue `nginx -s reload`
6. Mostra URL all'utente: `https://velvet-fox-42.Andy Code Cat.io`
7. Sotto l'URL: badge "Scade tra 24h" con countdown

**TTL e cleanup:**

- MongoDB TTL index su `SubdomainAllocation.expiresAt` (24h)
- Job BullMQ schedulato ogni ora: cerca allocations scadute, rimuove conf NGINX, cancella `dist/` dal filesystem, esegue `nginx -s reload`
- In alternativa: TTL di sessione (utente disconnesso → scaduta al logout + 30min grace). Per MVP si usa **24h fisso**, più semplice.

**Generazione subdomain:**

```typescript
// 200 aggettivi × 200 nomi × 100 numeri = 4.000.000 combinazioni possibili
const subdomain = `${pickRandom(adjectives)}-${pickRandom(nouns)}-${randomInt(10,99)}`;
// Verifica unicità in SubdomainAllocations (status: active)
// Max 3 retry se collision, poi errore 503
```

### 2.3 Subdomain Reserved (Feature 2b — seconda priorità)

**Flusso utente:**

1. Utente clicca "Prenota subdomain dedicato"
2. Input campo: `[_____________].Andy Code Cat.io`
3. Validazione real-time (debounce 300ms): `GET /v1/subdomains/check?name=mysite`
   - Risposta: `{ available: true }` o `{ available: false, reason: "already_taken" }`
4. Conferma → sistema prenota e deploya
5. URL permanente fino a cancellazione esplicita

**Regole subdomain riservato:**

- 3-30 caratteri
- Solo `[a-z0-9-]`, non inizia/finisce con `-`
- Blacklist: `www`, `api`, `admin`, `mail`, `Andy Code Cat`, `app`, `cdn`, ...
- Un utente può avere max 3 subdomain riservati sul piano Free, illimitati su Pro

**Prenotazione:**

- La prenotazione avviene al momento del primo deploy, non prima (no "booking" senza deploy)
- Se il deploy fallisce, la prenotazione viene rilasciata automaticamente
- Per aggiornare un subdomain riservato esistente: re-deploy sovrascrive `dist/` e ricarica nginx

### 2.4 API Endpoints Web Publishing

```
POST /v1/projects/:id/publish
```

**Body:**

```typescript
{
  type: 'random' | 'reserved';
  subdomain?: string;    // solo per type: 'reserved'
  visibility: 'public' | 'password' | 'private';
  password?: string;     // solo se visibility: 'password'
  snapshotId?: string;   // se omesso, usa ultimo snapshot
}
```

**Response (202 Accepted):**

```typescript
{
  deploymentId: string;
  status: 'deploying';
  url: string;           // https://{subdomain}.Andy Code Cat.io
  subdomain: string;
  expiresAt?: string;    // solo per type: 'random'
}
```

```
GET /v1/projects/:id/deployments           // lista deployment del progetto
GET /v1/deployments/:deploymentId          // stato singolo deployment
DELETE /v1/deployments/:deploymentId       // rimuovi deployment + pulizia nginx
GET /v1/subdomains/check?name=mysite       // verifica disponibilità
```

### 2.5 Flusso deploy interno

```typescript
// apps/api/src/application/use-cases/PublishProject.ts
class PublishProject {
  async execute(input): Promise<SiteDeployment> {
    // 1. Verifica che dist/ esiste per il progetto/snapshot
    // 2. Alloca subdomain (random o reserved):
    //    - random: genera, verifica unicità, inserisce SubdomainAllocation
    //    - reserved: verifica disponibilità, inserisce SubdomainAllocation
    // 3. Crea SiteDeployment con status: 'deploying'
    // 4. Accoda BullMQ job: DeployWorker
    // 5. Ritorna SiteDeployment (client fa polling o SSE)
  }
}

// Worker: apps/api/src/infrastructure/workers/DeployWorker.ts
class DeployWorker {
  async process(job): Promise<void> {
    // 1. Copia dist/ → /var/www/Andy Code Cat/{subdomain}/
    // 2. Genera nginx.conf da template Nunjucks
    // 3. Scrivi in /etc/nginx/sites-enabled/{subdomain}.conf
    // 4. nginx -t (verifica sintassi) → rollback se fallisce
    // 5. nginx -s reload
    // 6. Aggiorna SiteDeployment: status: 'live', deployedAt
    // 7. Se random: imposta expiresAt = now + 24h su SubdomainAllocation
  }
}
```

### 2.6 Template nginx.conf per virtual host

```nginx
# Template Nunjucks: nginx-templates/vhost.conf.njk
server {
    listen 80;
    server_name {{ subdomain }}.Andy Code Cat.io;

    root /var/www/Andy Code Cat/{{ subdomain }};
    index index.html;

    {% if visibility == 'password' %}
    auth_request /_pf_auth;
    auth_request_set $auth_status $upstream_status;

    location = /_pf_auth {
        internal;
        proxy_pass http://api:4000/_pf_auth/{{ subdomain }};
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
    }
    {% endif %}

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache assets statici
    location ~* \.(css|js|jpg|png|svg|woff2)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # Sicurezza base
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    {% if expiresAt %}
    # Random subdomain — scade {{ expiresAt }}
    add_header X-Andy Code Cat-Expires "{{ expiresAt }}";
    {% endif %}
}
```

In produzione (SSL): il template estende con blocco HTTPS e redirect 80→443.
Wildcard cert `*.Andy Code Cat.io` viene gestita separatamente (una tantum, non per virtual host).

---

## 3. MongoDB Schemas

### 3.1 `exports` — storico esportazioni ZIP

```typescript
interface ExportRecord {
  _id: ObjectId;
  projectId: ObjectId;
  userId: ObjectId;
  snapshotId?: ObjectId;       // quale snapshot è stato esportato

  status: 'pending' | 'ready' | 'failed' | 'expired';

  // Metadati file (non il file stesso — viene pulito dopo TTL)
  fileSize?: number;           // bytes
  fileSha256?: string;         // checksum per integrità
  filesIncluded: string[];     // ['index.html', 'style.css', ...]
  assetPlaceholders: Array<{
    path: string;              // 'assets/placeholder-hero.jpg'
    usedIn: string;            // 'index.html <img> hero section'
    recommendedSize?: string;  // '1920x600px'
  }>;

  // Download
  downloadToken?: string;      // JWT (hashed in DB per audit, non la versione raw)
  downloadTokenExpiresAt?: Date;
  downloadCount: number;       // quante volte scaricato

  createdAt: Date;
  expiresAt: Date;             // cleanup filesystem dopo questo timestamp
}

// Indici
db.exports.createIndex({ projectId: 1, createdAt: -1 });
db.exports.createIndex({ userId: 1 });
db.exports.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index MongoDB
```

### 3.2 `subdomain_allocations` — gestione sottodomini

```typescript
interface SubdomainAllocation {
  _id: ObjectId;
  subdomain: string;           // 'velvet-fox-42' o 'my-brand'
  type: 'random' | 'reserved';

  // Ownership
  userId: ObjectId;            // chi ha pubblicato
  projectId: ObjectId;         // progetto collegato

  // Stato
  status: 'active' | 'expired' | 'released';

  // TTL (solo random)
  expiresAt?: Date;            // null per reserved

  // Audit
  deploymentId: ObjectId;      // ref a SiteDeployment
  createdAt: Date;
  updatedAt: Date;
}

// Indici
db.subdomain_allocations.createIndex({ subdomain: 1 }, { unique: true, sparse: false });
// L'unicità è globale: anche se expired, il subdomain è ancora nel documento
// ma status: 'expired' consente re-allocazione (verifica: subdomain + status: 'active')
db.subdomain_allocations.createIndex({ subdomain: 1, status: 1 });
db.subdomain_allocations.createIndex({ userId: 1, type: 1 });
db.subdomain_allocations.createIndex({ projectId: 1 });
db.subdomain_allocations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-expire random
```

**Nota sull'unicità:** il TTL index di MongoDB rimuove il documento quando `expiresAt` passa (solo per `random`). Il subdomain diventa quindi ri-allocabile. I subdomain `reserved` non hanno `expiresAt` e vengono rimossi solo con cancellazione esplicita.

### 3.3 `site_deployments` — registro deployment live

```typescript
interface SiteDeployment {
  _id: ObjectId;
  projectId: ObjectId;
  userId: ObjectId;
  snapshotId?: ObjectId;

  // Indirizzo
  subdomain: string;
  url: string;                 // 'https://velvet-fox-42.Andy Code Cat.io'
  type: 'random' | 'reserved' | 'custom_domain';

  // Stato
  status: 'deploying' | 'live' | 'failed' | 'expired' | 'taken_down';
  errorMessage?: string;       // se status: 'failed'

  // Configurazione nginx
  nginxConfPath: string;       // '/etc/nginx/sites-enabled/velvet-fox-42.conf'
  nginxConfChecksum?: string;  // SHA-256 del conf per drift detection

  // SSL
  sslEnabled: boolean;
  sslCertPath?: string;
  sslExpiresAt?: Date;

  // Visibilità
  visibility: 'public' | 'password' | 'private';
  passwordHash?: string;       // bcrypt, solo se visibility: 'password'

  // Statistiche
  deployedAt?: Date;
  lastAccessedAt?: Date;       // aggiornato da nginx access log (Phase 2)
  allocationId: ObjectId;      // ref a SubdomainAllocation

  createdAt: Date;
  updatedAt: Date;
}

// Indici
db.site_deployments.createIndex({ projectId: 1, status: 1 });
db.site_deployments.createIndex({ subdomain: 1, status: 1 });
db.site_deployments.createIndex({ userId: 1, createdAt: -1 });
db.site_deployments.createIndex({ allocationId: 1 });
```

---

## 4. NGINX nel cluster Docker

### 4.1 Motivazione

Aggiungere nginx al `docker-compose.yml` consente:

- **Controllo completo** dei virtual host dinamici senza dipendere da nginx dell'host
- **Reload hot** tramite `docker exec Andy Code Cat-nginx nginx -s reload` (no restart, no downtime)
- **Volume condiviso** con l'API per scrittura diretta dei conf files e del `dist/`
- **Isolation** completa in dev/staging — stessa configurazione tra ambienti

### 4.2 Service nginx nel docker-compose

```yaml
nginx:
  image: nginx:1.25-alpine
  container_name: Andy Code Cat-nginx
  restart: unless-stopped
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro        # conf principale
    - ./nginx/sites-enabled:/etc/nginx/sites-enabled     # virtual hosts (scritti dall'API)
    - ./data/www:/var/www/Andy Code Cat                      # dist/ deployate
    - ./data/certs:/etc/letsencrypt:ro                   # certificati SSL
  depends_on:
    - api
  networks:
    - Andy Code Cat-net
```

**Directory layout su host:**

```
nginx/
├── nginx.conf          ← conf principale (include sites-enabled/*)
└── sites-enabled/      ← directory vuota, popolata dinamicamente dall'API
data/
├── www/
│   ├── velvet-fox-42/  ← dist/ deployata
│   └── my-brand/
└── certs/              ← wildcard cert *.Andy Code Cat.io
```

**nginx.conf principale:**

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    gzip on;
    gzip_types text/css application/javascript image/svg+xml;

    # Includi tutti i virtual host dinamici
    include /etc/nginx/sites-enabled/*.conf;

    # Fallback: 404 per subdomain non configurati
    server {
        listen 80 default_server;
        return 404;
    }
}
```

### 4.3 Comunicazione API → nginx

L'API non ha accesso diretto al processo nginx. Il reload avviene tramite **Docker socket** oppure un piccolo script:

**Opzione A (Docker socket — consigliata per MVP):**
L'API chiama `docker exec Andy Code Cat-nginx nginx -s reload` tramite il Docker SDK Node.js:

```typescript
// apps/api/src/infrastructure/nginx/NginxController.ts
import Docker from 'dockerode';

export class NginxController {
  private docker = new Docker({ socketPath: '/var/run/docker.sock' });

  async reload(): Promise<void> {
    const container = this.docker.getContainer('Andy Code Cat-nginx');
    await container.exec({
      Cmd: ['nginx', '-s', 'reload'],
      AttachStdout: true,
      AttachStderr: true,
    }).then(exec => exec.start({}));
  }

  async test(confPath: string): Promise<boolean> {
    // nginx -t prima del reload per catch errori sintassi
  }
}
```

```yaml
# Nel service api del docker-compose:
volumes:
  - /var/run/docker.sock:/var/run/docker.sock  # mount socket
```

**Opzione B (nginx-proxy sidecar):** più sicura per produzione (Phase 2).

### 4.4 Cleanup automatico subdomain scaduti

```typescript
// BullMQ job schedulato ogni ora
// apps/api/src/infrastructure/workers/SubdomainCleanupWorker.ts

async function cleanupExpiredSubdomains() {
  const expired = await SubdomainAllocationModel.find({
    type: 'random',
    status: 'active',
    expiresAt: { $lte: new Date() }
  });

  for (const allocation of expired) {
    // 1. Rimuovi conf file nginx
    await fs.unlink(`/nginx/sites-enabled/${allocation.subdomain}.conf`);
    // 2. Rimuovi dist/
    await fs.rm(`/data/www/${allocation.subdomain}`, { recursive: true });
    // 3. Aggiorna SiteDeployment status: 'expired'
    // 4. Aggiorna SubdomainAllocation status: 'expired'
  }

  if (expired.length > 0) {
    await nginxController.reload();
  }
}
```

---

## 5. Sequenza di sviluppo e dipendenze

```
M3 (GenerationWorker → dist/)
  │
  ├──→ M4a (ZIP Export)          ← standalone, nessuna dipendenza NGINX
  │      • ExportRecord schema
  │      • ExportProjectZip use-case
  │      • POST /export/zip + GET /download/:token
  │      • README generator + asset detector
  │
  └──→ M4b (nginx in Docker + Random Subdomain)
         • nginx service in docker-compose
         • NginxController (docker socket)
         • SubdomainAllocation schema
         • SiteDeployment schema
         • PublishProject use-case (type: random)
         • DeployWorker
         • Cleanup BullMQ worker schedulato
         • POST /publish + GET /deployments/:id
         │
         └──→ M4c (Reserved Subdomain)
                • SubdomainCheck endpoint
                • Blacklist validation
                • PublishProject use-case (type: reserved)
                • DELETE /deployments/:id
                • Piano quotas Free/Pro
```

**Priorità MVP:**

1. **M4a** — ZIP Export: valore immediato, zero rischi infrastrutturali
2. **M4b** — Random subdomain: demo rapida, valore alto, complessità media
3. **M4c** — Reserved subdomain: necessario per siti permanenti, dopo M4b stabile

**Stima complessità:**

- M4a: 1-2 giorni (use-case + ZIP generation + signed URL)
- M4b: 2-3 giorni (nginx Docker + worker + cleanup)
- M4c: 1 giorno (estende M4b con check unicità e blacklist)
