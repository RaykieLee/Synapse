# Wiki.js deployment

This Compose project runs Wiki.js 3 and connects it to the shared PostgreSQL 18
service. It does not run a second PostgreSQL container. Wiki.js uses the
least-privilege `wikijs` role and its own `wikijs` database; its database
password is supplied from `.db-secret` through Docker Compose secrets.

## Server layout

- Compose files and private environment: `/opt/docker/dockercompose/docs-wiki`
- Shared PostgreSQL data: named volume `infra_postgres18_data` under Docker's
  volume storage
- Wiki.js content and Git data: named volumes `docs_wiki_content` and
  `docs_wiki_repo`
- Wiki.js HTTP: `127.0.0.1:18080` on the host
- Wiki-to-PostgreSQL network: `infra_wiki_db`, with no database host port

The `infra_wiki_db` network is created by the shared infrastructure Compose
project. Wiki.js also uses its own default bridge network for outbound access;
it is not attached to the broader `infra_backend` network.

## Secrets and database provisioning

Keep `.env` and `.db-secret` private with mode `600`. For a new deployment,
create the database password without printing it:

```sh
umask 077
openssl rand -hex 32 > .db-secret
chmod 600 .env .db-secret
```

If migrating a pre-existing `WIKI_DB_PASSWORD` from `.env`, move it into the
secret file without displaying it, then remove the old environment entry:

```sh
umask 077
awk -F= '$1 == "WIKI_DB_PASSWORD" { sub(/^[^=]*=/, ""); print; found=1; exit }
  END { if (!found) exit 1 }' .env > .db-secret
sed -i '/^WIKI_DB_PASSWORD=/d' .env
chmod 600 .env .db-secret
```

After the shared PostgreSQL service is healthy, provision the database and
role idempotently from the secret file:

```sh
sh ./provision-db.sh
```

Then validate and start Wiki.js:

```sh
sudo docker compose --project-name docs-wiki config --quiet
sudo docker compose --project-name docs-wiki up -d
sudo docker compose --project-name docs-wiki ps
```

The initial administrator account comes from `WIKI_ADMIN_EMAIL` and
`WIKI_ADMIN_PASSWORD` on first startup. Store them only in the ignored server
`.env` file; never commit real secrets.

## Access and backup

Open a temporary SSH tunnel from the workstation:

```sh
ssh -N -L 18080:127.0.0.1:18080 <user>@<server>
```

Then browse to `http://127.0.0.1:18080`. Keep the published host binding on
loopback until a domain and reverse proxy are configured. Do not publish the
PostgreSQL port.

Wiki.js content is stored in the shared `wikijs` database. Back up that
database with the shared PostgreSQL backup routine, and back up `.env` and
`.db-secret` separately with restrictive permissions. Wiki.js local assets and
repository checkouts live in the two named Wiki.js volumes; include both in
backups. Avoid `docker compose down -v`.
