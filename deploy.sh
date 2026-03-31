#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing dependencies"
npm ci

echo "==> Generating Prisma client"
npx prisma generate

echo "==> Running database migration"
npx prisma migrate dev --name init --create-only 2>/dev/null || true
npx prisma db push

echo "==> Compiling TypeScript"
npx tsc

echo "==> Starting server"
node dist/server.js
