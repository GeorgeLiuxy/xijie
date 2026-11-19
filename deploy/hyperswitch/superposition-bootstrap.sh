#!/bin/sh
set -eu
case "${SP_DB_PASSWORD:-}" in ''|*[!0-9a-f]*) echo 'Invalid private configuration password' >&2; exit 1;; esac
service postgresql start
until pg_isready -h localhost -p 5432 -U postgres >/dev/null; do sleep 1; done
if ! psql -U postgres -Atc "SELECT 1 FROM pg_database WHERE datname='config'" | grep -qx 1; then
  createdb -U postgres config
fi
if ! psql -U postgres -d config -Atc "SELECT to_regclass('public.xijie_local_bootstrap') IS NOT NULL" | grep -qx t; then
  psql -U postgres -d config -v ON_ERROR_STOP=1 -f /app/db_init.sql
  psql -U postgres -d config -v ON_ERROR_STOP=1 -c 'CREATE TABLE public.xijie_local_bootstrap(version integer PRIMARY KEY); INSERT INTO public.xijie_local_bootstrap VALUES(1);'
fi
printf "ALTER USER postgres WITH PASSWORD '%s';\n" "$SP_DB_PASSWORD" | psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
exec /app/superposition
