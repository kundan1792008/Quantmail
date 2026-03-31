#!/bin/bash
set -euo pipefail

echo "=== Quantmail Deploy Script ==="

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy

# Build Docker image (if Docker is available)
if command -v docker &> /dev/null; then
  echo "Building Docker image..."
  docker build -t quantmail:latest .
  echo "Docker image built: quantmail:latest"
  echo ""
  echo "Run with: docker run -p 3000:3000 quantmail:latest"
else
  echo "Docker not found. Skipping container build."
  echo ""
  echo "Start the server with: npm start"
fi

echo ""
echo "=== Deploy complete ==="
