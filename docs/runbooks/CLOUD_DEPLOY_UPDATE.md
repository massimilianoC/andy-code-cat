# Cloud Droplet — Release Update Runbook

Runbook operativo per aggiornare i droplet cloud alla release corrente.
Segue lo stesso flusso per entrambi i droplet; eseguire in sequenza (prima droplet 1, poi droplet 2).

---

## Prima di iniziare

### 1. Verifica della release target

```bash
# In locale — confirma la release da deployare
cat RELEASE_VERSION          # deve essere 2026.06.10.1
git tag | grep 2026.06.10    # deve listare il tag
```

### 2. Verifica che main sia allineato al tag

```bash
git log origin/main --oneline -3
# Il commit più recente deve essere: release: 2026.06.10.1
```

---

## Aggiornamento su ogni droplet

### Step 1 — SSH nel droplet

```bash
ssh root@<DROPLET_IP>
# oppure
ssh <user>@<DROPLET_IP>
```

### Step 2 — Vai nella directory del progetto

```bash
cd /opt/andy-code-cat     # adatta al path di installazione effettivo
```

### Step 3 — Verifica lo stack in esecuzione prima di toccare qualcosa

```bash
docker compose -f docker-compose.deploy.yml ps
# Controlla che web, api, mongodb, redis, minio siano Up
# NON usare docker compose up (dev) su un droplet con deploy stack
```

### Step 4 — Pull del codice aggiornato

```bash
git fetch --tags origin
git checkout main
git pull origin main
# Verifica
cat RELEASE_VERSION   # 2026.06.10.1
git log --oneline -1  # release: 2026.06.10.1
```

### Step 5 — Rebuild solo web e api (mai mongodb/redis/minio)

```bash
docker compose -f docker-compose.deploy.yml build web api
```

> I dati sono in bind mount sotto `./data/` e non vengono mai toccati dal rebuild.

### Step 6 — Ricrea solo i container aggiornati

```bash
docker compose -f docker-compose.deploy.yml up -d --force-recreate --no-deps web api
```

### Step 7 — Health check

```bash
# API health
curl -s http://localhost:4000/health | grep -i ok

# Controlla i log per errori di avvio
docker compose -f docker-compose.deploy.yml logs --tail=50 api
docker compose -f docker-compose.deploy.yml logs --tail=50 web

# Verifica container up
docker compose -f docker-compose.deploy.yml ps
```

Se il dominio è configurato:

```bash
curl -s https://api.<DOMAIN>/health | grep -i ok
```

---

## Cosa verificare dopo il deploy (checklist funzionale)

| Check | Come |
|---|---|
| Login utente esistente | Prova login su `https://app.<DOMAIN>` |
| Dashboard carica | Apri un progetto esistente |
| VibeCore entry point | Avvia un nuovo zero-effort dalla dashboard |
| Brand Identity admin | `/admin/brand` risponde (nuova feature 2026.06.10.1) |
| API health | `GET /health` → 200 |

---

## Rollback

Se qualcosa non funziona dopo il deploy:

```bash
# Torna al commit precedente (era 2026.06.02.3)
git checkout 2026.06.02.3

# Rebuild e riavvia
docker compose -f docker-compose.deploy.yml build web api
docker compose -f docker-compose.deploy.yml up -d --force-recreate --no-deps web api
```

---

## Note specifiche per questa release (2026.06.10.1)

### Nuovi endpoint API

I seguenti route sono stati aggiunti — nessuna migrazione DB necessaria ma verifica che
il container api si avvii senza errori di startup:

- `GET/POST/DELETE /api/admin/brand` — Brand Identity assets (Layer G)
- `GET/POST /api/users/:id/brand` — Brand assets per utente

### MongoDB

Nessuna migrazione schema richiesta. Le nuove collection (`brandassets`) vengono
create automaticamente al primo inserimento.

### Variabili d'ambiente

Nessuna nuova variabile richiesta per questa release. Il blocco `CONFIGURATION`
in `install.sh` rimane invariato rispetto a `2026.06.02.3`.

---

## Sequenza consigliata sui 2 droplet

```
Droplet 1  ──→  aggiorna (Step 1–7)  ──→  health check OK  ──→
Droplet 2  ──→  aggiorna (Step 1–7)  ──→  health check OK
```

Aspetta la conferma del health check su Droplet 1 prima di procedere su Droplet 2.
In caso di anomalia su Droplet 1, esegui il rollback prima di toccare Droplet 2.
