#!/usr/bin/env bash
set -euo pipefail

APP_NAME="quantmail"
IMAGE_TAG="${APP_NAME}:latest"

echo "==> Building Docker image: ${IMAGE_TAG}"
docker build -t "${IMAGE_TAG}" .

echo "==> Running database migrations"
docker run --rm "${IMAGE_TAG}" npx prisma migrate deploy

echo "==> Starting ${APP_NAME} container"
docker run -d \
  --name "${APP_NAME}" \
  -p 3000:3000 \
  -e NODE_ENV=production \
  "${IMAGE_TAG}"

echo "==> ${APP_NAME} is running on http://localhost:3000"
echo "==> Health check: curl http://localhost:3000/health"
