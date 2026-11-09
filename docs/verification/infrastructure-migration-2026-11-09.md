# Shared infrastructure migration — 2026-11-09

## Result

The server now runs shared middleware as a separate Compose project. On
November 9, 2026, PostgreSQL was cut over from PostgreSQL 16 to PostgreSQL
18.6 with pgvector 0.8.7 on a new Docker volume. The PostgreSQL 16 volume was
preserved as a rollback point and was not mounted by PostgreSQL 18.

Wiki.js is configured to use the shared PostgreSQL service through a dedicated
database, role and network. Its host port remains loopback-only.

The current Synapse application image is still the existing release
`58670e9baf721d7088db32292efc118906d5bb8e`. This deployment does not claim
that the newer S3 application commit or an SQLite-to-PostgreSQL migration has
been released; the running API still points at its SQLite database.

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
| `infra-postgres` | `pgvector/pgvector:0.8.7-pg18-bookworm` | Shared PostgreSQL 18.6 with pgvector |
| `infra-redis` | `redis:7-alpine` | Existing Synapse Redis volume on the shared network |
| `infra-qdrant` | `qdrant/qdrant:latest` | Existing Synapse Qdrant volume on the shared network |
| `infra-rustfs` | `ghcr.io/rustfs/rustfs:1.0.4` | S3-compatible object storage |
| `infra-monitoring` | `nicolargo/glances:4.5.9` | Lightweight host and Docker monitoring |
| `synapse-api-1` | existing release image | FastAPI and embedded AgentScope |
| `synapse-web-1` | existing release image | Web and API reverse proxy |
| `docs-wiki` | `ghcr.io/requarks/wiki:3` | Wiki.js on shared PostgreSQL, loopback-only |

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
- PostgreSQL reported `18.6`; the `vector` extension reported `0.8.7` in the
  `synapse` database and a vector distance query returned successfully.
- The new `infra_postgres18_data` volume is mounted at `/var/lib/postgresql`;
  the old `infra_postgres_data` volume remains present.
- The shared `wikijs` database is owned by the non-superuser `wikijs` role and
  the `wiki` schema is owned by that role.
- `infra_backend` was inspected as internal and contained
  `infra-postgres`, `infra-redis`, `infra-qdrant`, `infra-rustfs` and
  `synapse-api-1`.
- RustFS data size remained approximately `108K` before and `112K` after
  startup. A recursive comparison excluding RustFS runtime metadata
  `.rustfs.sys` reported no user-data differences.
- A pre-migration backup was created at
  `/opt/infra/backups/pre-migration-20261109T065152Z`, including Compose
  files and compressed API, Redis and Qdrant volume data.
- A PostgreSQL-specific backup was created at
  `/opt/infra/backups/pg18-pgvector-preupgrade-20261109T081528Z`. It contains
  compressed globals and custom-format dumps for the `postgres` and `synapse`
  databases; gzip and `pg_restore --list` checks passed.
- A post-cutover PostgreSQL backup was created at
  `/opt/infra/backups/pg18-postcutover-20261109T093122Z`. It includes globals
  plus custom-format dumps for `postgres`, `synapse` and `wikijs`; every dump
  passed `pg_restore --list`, and the globals archive passed `gzip -t`. Both
  Compose files and private environment/secret files were also copied into the
  mode-`700` backup directory with mode-`600` file permissions.
- Wiki.js OCI image index digest matched the official GHCR manifest digest;
  the loaded image ID is
  `sha256:b72c33d3914ea0a74e11d9adb47be67ec7e68084c17e2546625a7ecda7397bb6`.
- Wiki.js reports a healthy container, its loopback HTTP endpoint returned
  `200 OK`, and its `wiki` schema contains 57 application tables.
- Post-restart checks report zero Wiki.js pages and two accounts (including
  the initialized administrator); this is an empty initial content set, not a
  content migration.
- PostgreSQL reports four idle Wiki.js connections as role `wikijs`; the Wiki.js
  container joins `infra_wiki_db` and is not attached to `infra_backend`.
- Synapse API health still returns HTTP 200 after the PostgreSQL cutover.

## Wiki.js deployment contract

- Compose files live at `/opt/docker/dockercompose/docs-wiki`.
- Wiki.js uses the external `infra_wiki_db` network to reach the shared
  PostgreSQL service and is not attached to `infra_backend`.
- The database password is stored in `/opt/docker/dockercompose/docs-wiki/.db-secret`
  with mode `600`; the deployment `.env` was also tightened to mode `600`.
- The Wiki.js host binding is `127.0.0.1:18080`; access is through an SSH
  tunnel until a reverse proxy and domain are deliberately configured.
- The Wiki.js schema initialization is complete; no separate Wiki.js
  PostgreSQL container or host-published database port exists.
- Wiki.js assets and repository paths are configured as the named volumes
  `docs_wiki_content` and `docs_wiki_repo`; the prior anonymous volumes were
  inspected empty before the explicit mounts were configured. HTTP 200 and
  container health passed after recreating only the Wiki.js container.
- The post-cutover backup includes the Wiki.js database and has mode-`600`
  files inside a mode-`700` directory.

## Resource sample

After Wiki.js started, a point-in-time sample reported approximately 3.3 GiB
host memory, 1.9 GiB available memory, and 41 GiB free disk. Container memory
was approximately 200 MiB for Wiki.js, 69 MiB for PostgreSQL, and 87 MiB for
Glances. After deleting temporary image-transfer archives, free disk space was
43 GiB. These are one-time observations, not historical monitoring or load
test results.

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
