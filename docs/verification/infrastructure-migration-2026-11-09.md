# Shared infrastructure migration — 2026-11-09

## Result

The server now runs shared middleware as a separate Compose project. The
application remains available and the migration preserved the existing Redis,
Qdrant and RustFS data paths without deleting Docker volumes.

The current Synapse application image is still the existing release
`58670e9baf721d7088db32292efc118906d5bb8e`. This deployment does not claim
that the newer S3 application commit or an SQLite-to-PostgreSQL migration has
been released.

## Server layout

Compose files:

- `/opt/docker/dockercompose/infra/docker-compose.yml`
- `/opt/docker/dockercompose/infra/.env`
- `/opt/docker/dockercompose/synapse/docker-compose.yml`
- `/opt/synapse/docker-compose.yml` remains as the compatibility path used by
  the existing release workflow.

Persistent and operational directories:

- `/opt/infra/PostgreSQL`
- `/opt/infra/Redis`
- `/opt/infra/Qdrant`
- `/opt/infra/RustFS/data`
- `/opt/infra/Monitoring`
- `/opt/synapse` for the application release and its existing API volume

## Running services

The following services were healthy after the switch:

| Service | Image | Role |
| --- | --- | --- |
| `infra-postgres` | `postgres:16-alpine` | Shared PostgreSQL, provisioned but not yet used by Synapse |
| `infra-redis` | `redis:7-alpine` | Existing Synapse Redis volume on the shared network |
| `infra-qdrant` | `qdrant/qdrant:latest` | Existing Synapse Qdrant volume on the shared network |
| `infra-rustfs` | `ghcr.io/rustfs/rustfs:1.0.4` | S3-compatible object storage |
| `infra-monitoring` | `nicolargo/glances:4.5.9` | Lightweight host and Docker monitoring |
| `synapse-api-1` | existing release image | FastAPI and embedded AgentScope |
| `synapse-web-1` | existing release image | Web and API reverse proxy |

The scheduler remains embedded in the API process. A separate Scheduler
container was not introduced because the current runtime starts the polling
loop from the API lifespan; adding another copy would risk duplicate claims.

## Network contract

- `infra_backend` is the internal shared network.
- Synapse API joins `infra_backend`; Web does not.
- `infra_access` is limited to infrastructure services that publish
  loopback-only diagnostic ports.
- Redis, Qdrant and RustFS are reachable from the API through service aliases
  on `infra_backend`.
- Network membership is not a tenant or Workspace authorization boundary.

## Evidence

- API health returned HTTP 200 from both `127.0.0.1:8010/api/v1/health` and the
  Web proxy path `/api/v1/health`.
- API-to-RustFS health returned HTTP 200 through `http://rustfs:9000/health`.
- RustFS S3 health returned HTTP 200 on `127.0.0.1:19000/health`.
- RustFS Console health returned HTTP 200 on
  `127.0.0.1:19001/rustfs/console/health`.
- Glances returned HTTP 200 on `127.0.0.1:16128/`.
- PostgreSQL `pg_isready -U synapse -d synapse` reported accepting connections.
- `infra_backend` was inspected as internal and contained
  `infra-postgres`, `infra-redis`, `infra-qdrant`, `infra-rustfs` and
  `synapse-api-1`.
- RustFS data size remained approximately `108K` before and `112K` after
  startup. A recursive comparison excluding RustFS runtime metadata
  `.rustfs.sys` reported no user-data differences.
- A pre-migration backup was created at
  `/opt/infra/backups/pre-migration-20261109T065152Z`, including Compose
  files and compressed API, Redis and Qdrant volume data.

## Monitoring choice

Glances was selected for this 2-vCPU, approximately 3.3 GiB RAM server because
the first monitoring layer only needs live host/container visibility and
should not add a Prometheus, time-series database and dashboard stack. It runs
as one container, binds to `127.0.0.1:16128`, and is intended to be reached
through an SSH tunnel:

```text
ssh -N -L 16128:127.0.0.1:16128 <user>@<server>
```

It is not a replacement for long-term alerting or retained metrics. If
historical charts, alert rules and multi-host monitoring become necessary,
evaluate Beszel before introducing a heavier Prometheus/Grafana stack.

## Remaining work

- Create the RustFS attachment bucket and a least-privilege application
  credential.
- Deploy the S3-enabled Synapse application image.
- Back up and migrate local attachments with the existing migration command,
  verify object counts/checksums, then switch the API backend to S3.
- Treat SQLite-to-PostgreSQL as a separate migration with rehearsal and
  rollback evidence.
- Remove the old `/opt/synapse-rustfs/data` copy and legacy attachment network
  only after the S3 cutover and rollback window close.
