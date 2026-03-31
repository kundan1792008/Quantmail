#!/usr/bin/env bash
set -euo pipefail

echo "=== Quantmail Deploy ==="
echo "Building Docker image..."
docker build -t quantmail:latest .
echo "Image built successfully."
echo "Run with: docker run -p 3000:3000 quantmail:latest"
