#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if [ ! -r .db-secret ]; then
  printf '%s\n' 'Missing readable .db-secret' >&2
  exit 1
fi

db_password=$(tr -d '\r\n' < .db-secret)
if [ -z "$db_password" ]; then
  printf '%s\n' '.db-secret is empty' >&2
  exit 1
fi

escaped_password=$(printf '%s' "$db_password" | sed "s/'/''/g")
role_exists=$(sudo docker exec infra-postgres psql -U synapse -d postgres -X -qAt -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_roles WHERE rolname = 'wikijs'")

if [ "$role_exists" = "1" ]; then
  role_sql="ALTER ROLE wikijs WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$escaped_password';"
else
  role_sql="CREATE ROLE wikijs WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$escaped_password';"
fi

printf '%s\n' "$role_sql" | sudo docker exec -i infra-postgres psql -U synapse -d postgres -X -v ON_ERROR_STOP=1

database_exists=$(sudo docker exec infra-postgres psql -U synapse -d postgres -X -qAt -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname = 'wikijs'")

if [ "$database_exists" = "1" ]; then
  printf '%s\n' 'ALTER DATABASE wikijs OWNER TO wikijs;' | sudo docker exec -i infra-postgres psql -U synapse -d postgres -X -v ON_ERROR_STOP=1
else
  printf '%s\n' 'CREATE DATABASE wikijs OWNER wikijs;' | sudo docker exec -i infra-postgres psql -U synapse -d postgres -X -v ON_ERROR_STOP=1
fi

printf '%s\n' 'CREATE SCHEMA IF NOT EXISTS wiki AUTHORIZATION wikijs;' 'ALTER SCHEMA wiki OWNER TO wikijs;' | sudo docker exec -i infra-postgres psql -U synapse -d wikijs -X -v ON_ERROR_STOP=1

unset db_password escaped_password role_sql
printf '%s\n' 'Provisioned shared PostgreSQL database wikijs.'
