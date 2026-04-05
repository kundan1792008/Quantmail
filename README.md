# Quantmail

Quantmail is a biometric identity gateway built with **Fastify**, **Prisma** (SQLite via `better-sqlite3`), and **TypeScript**.

---

## Getting Started

### Prerequisites

- Node.js 22+
- npm 10+

### Install dependencies

```bash
npm ci
```

### Generate the Prisma client

```bash
npm run prisma:generate
```

### Run in development mode

```bash
npm run dev
```

### Run linter (type-check)

```bash
npm run lint
```

### Build for production

```bash
npm run build
```

### Run tests

```bash
npm run test
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Port the server listens on (default `3000`) |
| `DATABASE_URL` | Yes | Prisma SQLite path, e.g. `file:./prisma/dev.db` |
| `SSO_SECRET` | Yes | Secret for signing SSO session tokens (≥ 32 random chars) |
| `LIVENESS_PROVIDER` | No | Liveness backend: `local` (default), `incode`, or `microblink` |
| `INCODE_API_KEY` | Conditional | Required when `LIVENESS_PROVIDER=incode` |
| `MICROBLINK_API_KEY` | Conditional | Required when `LIVENESS_PROVIDER=microblink` |
| `DEVICE_PROOF_HMAC_SECRET` | Yes | HMAC secret for IoT device proof tokens (≥ 32 random chars) |
| `SYNCHRONIZED_TRIGGER_DELAY_MS` | No | Critical-alarm trigger delay in ms (default `1500`) |

> **Never commit a populated `.env` file.** The `.gitignore` already excludes it.

### Setting GitHub Secrets for CI/CD

For the deployment workflow to push the Docker image you must add the following **Repository Secrets** under *Settings → Secrets and variables → Actions*:

| Secret Name | Description |
|---|---|
| `DOCKER_USERNAME` | Your Docker Hub username |
| `DOCKER_PASSWORD` | A Docker Hub access token (not your password) |

All application environment variables (`SSO_SECRET`, `DEVICE_PROOF_HMAC_SECRET`, etc.) should also be stored as secrets on your hosting platform (or injected at container start via `-e` flags / a `.env` file on the server).

---

## CI/CD Pipeline

### Continuous Integration (`.github/workflows/ci.yml`)

Triggers on every **Pull Request** targeting `main`.

Steps:
1. Install dependencies (`npm ci`)
2. Generate Prisma client (`npx prisma generate`)
3. Lint / type-check (`npm run lint`)
4. Build (`npm run build`)
5. Test (`npm run test`)

All steps must pass before a PR can be merged.

### Continuous Deployment (`.github/workflows/deploy.yml`)

Triggers on every **push to `main`** (i.e. after a PR is merged).

Steps:
1. Install, generate, build & test (same as CI)
2. Build the Docker image
3. Push to Docker Hub as `<DOCKER_USERNAME>/quantmail:latest` and `:<git-sha>`

To run the published image locally:

```bash
docker run -p 3000:3000 \
  -e SSO_SECRET=your-secret \
  -e DEVICE_PROOF_HMAC_SECRET=your-secret \
  <DOCKER_USERNAME>/quantmail:latest
```

---

## Branch Protection (Recommended)

To prevent anyone from pushing directly to `main` without passing CI:

1. Go to **Settings → Branches** in this repository.
2. Click **Add branch protection rule**.
3. Set **Branch name pattern** to `main`.
4. Enable:
   - ✅ **Require a pull request before merging**
   - ✅ **Require status checks to pass before merging**
     - Add the `Lint, Build & Test` check from the CI workflow.
   - ✅ **Require branches to be up to date before merging**
   - ✅ **Do not allow bypassing the above settings** (recommended for production)
5. Click **Save changes**.

This ensures every change to `main` has been validated by the full CI pipeline.

---

## Docker

Build locally:

```bash
docker build -t quantmail:latest .
```

Run:

```bash
docker run -p 3000:3000 quantmail:latest
```

Or use the provided helper script:

```bash
./deploy.sh
```
