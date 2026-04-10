# Local Docker Start

## Prerequisites

- Docker Desktop
- Node.js 20+

## Mode 1: Dev Containers (live code)

Use this mode while developing with bind-mount and hot reload.

1. Verify .env.docker exists (already committed for bootstrap).
2. Run: docker compose up --build
3. Check API: <http://localhost:4000/health>
4. Check Web: <http://localhost:8081>

## Mode 2: Self-contained Deploy Stack

Use this mode for isolated runtime and future droplet deployment.

1. Run: docker compose -f docker-compose.deploy.yml up --build -d
2. Check API: <http://localhost:4000/health>
3. Check Web: <http://localhost:8081>

## Notes

- In deploy mode there are no source bind-mounts for api/web.
- Mongo data uses named volume mongodb_data.
- Redis data uses named volume redis_data.
- Mongo is mapped to host port 27018.
- Redis is mapped to host port 6380.
