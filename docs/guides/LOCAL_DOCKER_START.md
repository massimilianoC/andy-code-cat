# Local Docker Start

## Prerequisites

- Docker Desktop
- Node.js 20+

---

## Recommended: Self-Configuring Installer (`install.sh`)

For **new deployments** (local or domain), use the one-file installer at the repo root:

1. Open `install.sh` and edit the `CONFIGURATION` block at the top:
   - Set `MODE="local"` or `MODE="domain"`
   - Set `DOMAIN` and `CERTBOT_EMAIL` (domain mode only)
   - Set at least one LLM API key (`SILICONFLOW_API_KEY` or `OPENROUTER_API_KEY`)
2. Run: `bash install.sh`

The script generates `.env.docker`, starts all containers, and (in domain mode) obtains SSL
certificates automatically via certbot. When done it prints the URL to the setup wizard.

**Local mode** → <http://localhost/install>
**Domain mode** → `https://app.DOMAIN/install`

See the inline comments at the top of `install.sh` for DNS record requirements in domain mode.

---

## Mode 1: Dev Containers (live code, hot-reload)

Use this mode while developing. Source files are bind-mounted; no image rebuild needed for
code changes.

```bash
docker compose up -d
```

Check API: <http://localhost:4000/health>
Check Web: <http://localhost:8081>

---

## Mode 2: Self-contained Deploy Stack

Use this for isolated runtime testing or a prod-like image.

```bash
docker compose -f docker-compose.deploy.yml up --build -d
```

---

## Safe Rebuild (after Dockerfile or dependency changes)

**Rebuilds only the web and API images, leaves MongoDB / MinIO untouched.**
Data is stored in `./data/` bind mounts and is never affected by image rebuilds.

```bash
# Rebuild images (does NOT touch data volumes)
docker compose build web api

# Restart only those containers with the new images
docker compose up -d --force-recreate --no-deps web api
```

If only one service changed:

```bash
docker compose build web && docker compose up -d --force-recreate --no-deps web
docker compose build api && docker compose up -d --force-recreate --no-deps api
```

---

## Data Storage

All persistent data lives in bind mounts under `./data/`:

| Service | Host path | Container path |
|---|---|---|
| MongoDB | `./data/mongodb` | `/data/db` |
| MinIO | `./data/minio` | `/data` |

`docker compose up`, `docker compose build`, and `docker compose up --build` **never delete**
bind-mount data. Only `rm -rf ./data/` would erase it.

---

## First Run — Create the First Superadmin

On a fresh deployment (empty database) there is no superadmin account. Register an account at
`/register`, then verify and promote it with `mongosh` as shown below. `install.sh` prints the
one-line version of this command at the end of its output.

No verification e-mail is sent. With `AUTH_BYPASS_EMAIL_VERIFICATION=false` (the `install.sh`
default) an account can log in only once it is marked verified — by the command below for the
first superadmin, and in `/admin/users` for everyone after that.

A guided `/install` wizard is specified in
[docs/specs/FIRST_INSTALL_SETUP_SPEC.md](../specs/FIRST_INSTALL_SETUP_SPEC.md) but is not
implemented yet.

---

## Promote a User to Superadmin via mongosh

```bash
# 1. Open a mongosh session inside the container
docker exec -it andy-code-cat-mongodb mongosh

# 2. Switch to the app database
use andy-code-cat

# 3. Find the user (verify email)
db.users.findOne({ email: "your@email.com" }, { email: 1, roles: 1 })

# 4. Promote
db.users.updateOne(
    { email: "your@email.com" },
    { $set: { roles: ["superadmin"], emailVerified: true } }
)

# 5. Confirm
db.users.findOne({ email: "your@email.com" }, { email: 1, roles: 1 })
# Expected: { email: "...", roles: ["superadmin"] }
```

After promotion the user must **log out and log back in** to get a new JWT with the
`superadmin` role claim. Access tokens expire in 15 minutes naturally; force-expiry is not
required unless you need immediate effect.

---

## Useful Commands

```bash
# Stop the stack (data untouched)
docker compose down

# Tail logs for a specific service
docker compose logs -f web
docker compose logs -f api

# Open a shell in the API container
docker exec -it andy-code-cat-api sh

# Check MongoDB document counts
docker exec -it andy-code-cat-mongodb mongosh --eval \
  'use("andy-code-cat"); ["users","projects","sessions"].forEach(c => print(c, db[c].countDocuments()))'
```
