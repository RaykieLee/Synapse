# Shared infrastructure

This Compose project owns shared middleware for the Synapse deployment:

- PostgreSQL, provisioned for the planned SQLite-to-PostgreSQL migration.
- Redis, retaining the existing Synapse named volume.
- Qdrant, retaining the existing Synapse named volume.
- RustFS, on the shared internal network and backed by `RustFS/data`.
- Glances, a single-container host and Docker monitor.

On the target server, keep the Compose project at
`/opt/docker/dockercompose/infra`. Keep persistent service data under
`/opt/infra`; the `.env` file should set `RUSTFS_DATA_PATH=/opt/infra/RustFS/data`.

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

Never run `docker compose down -v` for this stack. Redis and Qdrant use
external volumes so that moving the Compose project does not recreate their
data.
