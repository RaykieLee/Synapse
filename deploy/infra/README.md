# Shared infrastructure

This Compose project owns shared middleware for the Synapse deployment:

- PostgreSQL 18 with the pgvector extension binaries available.
- Redis, retaining the existing Synapse named volume.
- Qdrant, retaining the existing Synapse named volume.
- RustFS, on the shared internal network and backed by `RustFS/data`.
- Glances, a single-container host and Docker monitor.

On the target server, keep the Compose project at
`/opt/docker/dockercompose/infra`. Keep persistent service data under
`/opt/infra`; the `.env` file should set `RUSTFS_DATA_PATH=/opt/infra/RustFS/data`.

The PostgreSQL 18 volume defaults to `infra_postgres18_data` and is mounted at
`/var/lib/postgresql`, the parent of PostgreSQL 18's versioned data directory.
Do not mount the PostgreSQL 16 volume at this path or reuse it with PostgreSQL
18. The old `infra_postgres_data` volume remains an independent rollback point.

The pgvector image provides the extension files, but the SQL extension is
enabled per database. After migration, enable it only in databases that need
vector columns:

```sh
sudo docker exec infra-postgres psql -U synapse -d synapse \
  -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

Wiki.js uses a dedicated `wikijs` role and `wikijs` database on this shared
PostgreSQL service. The isolated `infra_wiki_db` network lets Wiki.js reach only
PostgreSQL rather than the other middleware containers.

## PostgreSQL migration safeguards

- Take and validate a logical backup of roles and every non-template database
  before replacing the PostgreSQL 16 container.
- Use a new PostgreSQL 18 volume; preserve `infra_postgres_data` untouched.
- Never run `docker compose down -v` for this stack.
- For a rollback before accepting new writes, set `POSTGRES_IMAGE=postgres:16-alpine`,
  `POSTGRES_VOLUME=infra_postgres_data`, and
  `POSTGRES_DATA_MOUNT=/var/lib/postgresql/data`, then recreate only PostgreSQL.
  Writes made after the cutover remain on the PostgreSQL 18 volume and must be
  exported separately before rolling back.

Only `infra_backend` is shared with the server-side Synapse containers. The Web
container stays on the edge network and does not receive direct access to
middleware. `infra_access` is reserved for infrastructure containers that need
loopback-only host diagnostics; no Synapse application container joins it.
Redis databases, Qdrant collections, RustFS buckets/prefixes and PostgreSQL
databases or schemas still require service-level isolation; network membership
is not an authorization boundary.

Glances is bound to `127.0.0.1` by default. Reach it from a workstation with:

```text
ssh -N -L 16128:127.0.0.1:16128 <user>@<server>
```

Then open `http://127.0.0.1:16128`. The Docker socket is mounted read-only so
the monitor can show container metrics. Do not expose the monitoring port to
the public network.

The current scheduler remains embedded in the API process. Do not add a second
Scheduler container until the scheduler entrypoint and single-owner/claim
contract are deliberately separated and independently verified.

Redis and Qdrant use external volumes so that moving the Compose project does
not recreate their data.
