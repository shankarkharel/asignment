#!/usr/bin/env sh
# Creates a local .env from .env.example with freshly generated random secrets.
# Secrets are never committed; every developer gets their own.
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists - leaving it untouched." >&2
  exit 0
fi

rand_hex() { openssl rand -hex "$1"; }

sed \
  -e "s|^DATABASE_PASSWORD=.*|DATABASE_PASSWORD=$(rand_hex 16)|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$(rand_hex 32)|" \
  -e "s|^FIELD_ENCRYPTION_KEY=.*|FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32)|" \
  -e "s|^SEED_USER_PASSWORD=.*|SEED_USER_PASSWORD=$(rand_hex 12)|" \
  .env.example > .env

echo "Created .env with random secrets. Demo user password: $(grep '^SEED_USER_PASSWORD=' .env | cut -d= -f2)"
