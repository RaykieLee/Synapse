#!/bin/sh
set -eu

mkdir -p \
  /data/synapse \
  /data/attachments \
  /data/agentscope/workspaces \
  /data/agentscope/blobs

alembic upgrade head
exec "$@"
